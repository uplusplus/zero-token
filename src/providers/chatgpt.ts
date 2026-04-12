/// <reference lib="dom" />
/**
 * ChatGPT Web Provider — cookie + session auth, DOM interaction via Playwright CDP.
 * Ported from openclaw-zero-token.
 *
 * Uses page.evaluate() to execute fetch within browser context (with sentinel token),
 * falls back to DOM input+poll if 403.
 */

import { chromium, type BrowserContext, type Page } from "playwright-core";
import type {
  ProviderAdapter,
  ModelDefinition,
  ChatCompletionRequest,
  StreamCallbacks,
} from "../types.js";
import { buildPrompt, DEFAULT_USER_AGENT, stringToReadableStream } from "./base.js";
import {
  getChromeWebSocketUrl,
  isChromeReachable,
  cdpUrlForPort,
} from "../browser/cdp.js";
import { parseChatGPTSSEStream } from "../streams/chatgpt-parser.js";

export interface ChatGPTProviderOptions {
  cookie: string;
  accessToken?: string;
  userAgent?: string;
  cdpPort?: number;
  cdpUrl?: string;
}

export function createChatGPTModels(): ModelDefinition[] {
  return [
    {
      id: "gpt-4",
      name: "GPT-4",
      provider: "chatgpt-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 8192,
      maxTokens: 4096,
    },
    {
      id: "gpt-4-turbo",
      name: "GPT-4 Turbo",
      provider: "chatgpt-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "chatgpt-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 16384,
    },
    {
      id: "o1",
      name: "o1",
      provider: "chatgpt-web",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 100000,
    },
  ];
}

const BASE_URL = "https://chatgpt.com";

export class ChatGPTProvider implements ProviderAdapter {
  readonly id = "chatgpt-web";
  readonly name = "ChatGPT Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private accessToken: string;
  private userAgent: string;
  private cdpPort: number;
  private cdpUrl: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(opts: ChatGPTProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.accessToken = opts.accessToken ?? "";
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.cdpPort = opts.cdpPort ?? 9333;
    this.cdpUrl = opts.cdpUrl ?? cdpUrlForPort(this.cdpPort);
    this.models = models ?? createChatGPTModels();
  }

  async init(): Promise<void> {
    await this.ensureBrowser();
    console.log("[chatgpt-web] Initialized");
  }

  async close(): Promise<void> {
    this.page = null;
    this.context = null;
  }

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      const { page } = await this.ensureBrowser();
      const prompt = buildPrompt(request.messages);
      if (!prompt) throw new Error("No message to send");

      const model = request.model || "gpt-4";

      // Try API approach first (with sentinel)
      const responseData = await page.evaluate(
        async ({ message, model }) => {
          try {
            const session = await fetch("https://chatgpt.com/api/auth/session", { credentials: "include" })
              .then(r => r.ok ? r.json() : null).catch(() => null);
            const accessToken = session?.accessToken;
            const deviceId = crypto.randomUUID();

            const baseHeaders: Record<string, string> = {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              "oai-device-id": deviceId,
              "oai-language": "en-US",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            };

            const res = await fetch("https://chatgpt.com/backend-api/conversation", {
              method: "POST",
              headers: baseHeaders,
              body: JSON.stringify({
                action: "next",
                messages: [{
                  id: crypto.randomUUID(),
                  author: { role: "user" },
                  content: { content_type: "text", parts: [message] },
                }],
                parent_message_id: crypto.randomUUID(),
                model,
                timezone_offset_min: new Date().getTimezoneOffset(),
                conversation_mode: { kind: "primary_assistant" },
                force_use_sse: true,
              }),
              credentials: "include",
            });

            if (!res.ok) {
              const errText = await res.text();
              return { ok: false, status: res.status, error: errText };
            }

            const reader = res.body?.getReader();
            if (!reader) return { ok: false, status: 500, error: "No body" };

            const decoder = new TextDecoder();
            let fullText = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              fullText += decoder.decode(value, { stream: true });
            }
            return { ok: true, data: fullText };
          } catch (err) {
            return { ok: false, status: 500, error: String(err) };
          }
        },
        { message: prompt, model },
      );

      if (responseData.ok) {
        // Parse SSE data using enhanced ChatGPT stream parser
        const raw = responseData.data || "";
        const stream = stringToReadableStream(raw);

        for await (const chunk of parseChatGPTSSEStream(stream)) {
          switch (chunk.type) {
            case "text":
              if (chunk.content) callbacks.onText(chunk.content);
              break;
            case "thinking":
              if (chunk.content) callbacks.onReasoning(chunk.content);
              break;
            case "tool_call":
              if (chunk.toolCall) callbacks.onToolCall({
                id: chunk.toolCall.id,
                type: "function",
                function: { name: chunk.toolCall.name, arguments: chunk.toolCall.arguments },
              });
              break;
            case "done":
              callbacks.onDone();
              return;
            case "error":
              callbacks.onError(new Error(chunk.error ?? "Stream error"));
              return;
          }
        }
        callbacks.onDone();
        return;
      }

      // Fallback to DOM interaction
      if (responseData.status === 403 || responseData.status === 401) {
        await this.chatViaDOM(prompt, callbacks);
        return;
      }

      throw new Error(`ChatGPT API error: ${responseData.status} - ${responseData.error?.slice(0, 200)}`);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async chatViaDOM(prompt: string, callbacks: StreamCallbacks): Promise<void> {
    const page = this.page!;

    const inputSel = "#prompt-textarea, textarea[placeholder], textarea, [contenteditable='true']";
    const inputHandle = await page.$(inputSel);
    if (!inputHandle) throw new Error("ChatGPT: input not found on page");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(prompt, { delay: 20 });
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");

    const maxWaitMs = 90000;
    let lastText = "";
    let stableCount = 0;

    for (let elapsed = 0; elapsed < maxWaitMs; elapsed += 2000) {
      await page.waitForTimeout(2000);

      const text = await page.evaluate(() => {
        const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        const els = document.querySelectorAll('div[data-message-author-role="assistant"], [class*="markdown"]');
        const last = els.length > 0 ? els[els.length - 1] : null;
        return last ? clean(last.textContent ?? "") : "";
      });

      if (text && text !== lastText) {
        lastText = text;
        stableCount = 0;
      } else if (text) {
        stableCount++;
        const isStreaming = await page.evaluate(() =>
          !!document.querySelector('button .icon-lg, [aria-label*="Stop"]')
        );
        if (!isStreaming && stableCount >= 2) break;
      }
    }

    if (!lastText) throw new Error("ChatGPT: no response detected via DOM");

    callbacks.onText(lastText);
    callbacks.onDone();
  }

  private async ensureBrowser(): Promise<{ context: BrowserContext; page: Page }> {
    if (this.context && this.page) return { context: this.context, page: this.page };

    const reachable = await isChromeReachable(this.cdpUrl, 2000);
    if (!reachable) {
      throw new Error(`ChatGPT: Chrome not reachable at ${this.cdpUrl}. Start with --remote-debugging-port=9333.`);
    }

    const wsUrl = await getChromeWebSocketUrl(this.cdpUrl, 5000);
    if (!wsUrl) throw new Error(`ChatGPT: cannot get WebSocket URL`);

    const browser = await chromium.connectOverCDP(wsUrl);
    this.context = browser.contexts()[0];
    if (!this.context) this.context = await browser.newContext();

    const pages = this.context.pages();
    this.page = pages.find(p => p.url().includes("chatgpt.com")) ?? null;
    if (!this.page) {
      this.page = await this.context.newPage();
      await this.page.goto(BASE_URL, { waitUntil: "load" });
    }

    if (this.cookie) {
      const cookies = this.cookie.split(";").map(c => {
        const [name, ...valueParts] = c.trim().split("=");
        return { name: name.trim(), value: valueParts.join("=").trim(), domain: ".chatgpt.com", path: "/" };
      }).filter(c => c.name);
      if (cookies.length > 0) await this.context.addCookies(cookies).catch(() => {});
    }

    return { context: this.context, page: this.page };
  }
}
