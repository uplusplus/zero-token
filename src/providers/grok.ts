/// <reference lib="dom" />
/**
 * Grok Web Provider — cookie auth, DOM interaction via Playwright CDP.
 * Ported from openclaw-zero-token.
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
import { parseGrokSSEStream } from "../streams/grok-parser.js";

export interface GrokProviderOptions {
  cookie: string;
  userAgent?: string;
  cdpPort?: number;
  cdpUrl?: string;
}

export function createGrokModels(): ModelDefinition[] {
  return [
    {
      id: "grok-1",
      name: "Grok 1",
      provider: "grok-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 8192,
      maxTokens: 4096,
    },
    {
      id: "grok-2",
      name: "Grok 2",
      provider: "grok-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 16384,
    },
    {
      id: "grok-3",
      name: "Grok 3",
      provider: "grok-web",
      reasoning: true,
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 64000,
    },
  ];
}

export class GrokProvider implements ProviderAdapter {
  readonly id = "grok-web";
  readonly name = "Grok Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private userAgent: string;
  private cdpPort: number;
  private cdpUrl: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(opts: GrokProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.cdpPort = opts.cdpPort ?? 9333;
    this.cdpUrl = opts.cdpUrl ?? cdpUrlForPort(this.cdpPort);
    this.models = models ?? createGrokModels();
  }

  async init(): Promise<void> {
    await this.ensureBrowser();
    console.log("[grok-web] Initialized");
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

      const model = request.model || "grok-2";

      // Try API approach via page.evaluate
      const responseData = await page.evaluate(
        async ({ message, model }) => {
          try {
            // Get or create conversation
            let convId: string | undefined;
            const m = window.location.pathname.match(/\/c\/([a-f0-9-]{36})/);
            convId = m?.[1];

            if (!convId) {
              try {
                const listRes = await fetch("https://grok.com/rest/app-chat/conversations?limit=1", { credentials: "include" });
                if (listRes.ok) {
                  const list = await listRes.json();
                  convId = list?.conversations?.[0]?.conversationId;
                }
              } catch { /* ignore */ }
            }

            if (!convId) {
              const createRes = await fetch("https://grok.com/rest/app-chat/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({}),
              });
              if (createRes.ok) {
                const data = await createRes.json();
                convId = data?.conversationId ?? data?.id;
              }
            }

            if (!convId) return { ok: false, status: 404, error: "No conversation" };

            const res = await fetch(`https://grok.com/rest/app-chat/conversations/${convId}/responses`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                message,
                parentResponseId: crypto.randomUUID(),
                disableSearch: false,
                enableImageGeneration: false,
                modelMode: "MODEL_MODE_AUTO",
              }),
            });

            if (!res.ok) return { ok: false, status: res.status, error: await res.text() };
            if (!res.body) return { ok: false, status: 500, error: "No body" };

            const reader = res.body.getReader();
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
        // Parse NDJSON response using enhanced Grok stream parser
        const raw = responseData.data || "";
        const stream = stringToReadableStream(raw);

        for await (const chunk of parseGrokSSEStream(stream)) {
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

      // Fallback to DOM
      await this.chatViaDOM(prompt, callbacks);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async chatViaDOM(prompt: string, callbacks: StreamCallbacks): Promise<void> {
    const page = this.page!;

    const inputSelectors = ['[contenteditable="true"]', "textarea[placeholder]", "textarea", 'div[role="textbox"]'];
    let inputHandle = null;
    for (const sel of inputSelectors) {
      inputHandle = await page.$(sel);
      if (inputHandle) break;
    }
    if (!inputHandle) throw new Error("Grok: input not found on page");

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(prompt, { delay: 20 });
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");

    const maxWaitMs = 90000;
    let lastText = "";
    let stableCount = 0;

    for (let elapsed = 0; elapsed < maxWaitMs; elapsed += 2000) {
      await page.waitForTimeout(2000);

      const result = await page.evaluate(() => {
        const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        const selectors = [
          '[data-role="assistant"]',
          '[class*="assistant"]',
          '[class*="response"]',
          '[class*="markdown"]',
          ".prose",
        ];
        let text = "";
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          const last = els.length > 0 ? els[els.length - 1] : null;
          if (last) {
            const t = clean((last as HTMLElement).textContent ?? "");
            if (t.length > 10) { text = t; break; }
          }
        }
        const isStreaming = !!document.querySelector('[aria-label*="Stop"], [aria-label*="stop"]');
        return { text, isStreaming };
      });

      if (result.text && result.text !== lastText) {
        lastText = result.text;
        stableCount = 0;
      } else if (result.text) {
        stableCount++;
        if (!result.isStreaming && stableCount >= 2) break;
      }
    }

    if (!lastText) throw new Error("Grok: no response detected via DOM");

    callbacks.onText(lastText);
    callbacks.onDone();
  }

  private async ensureBrowser(): Promise<{ context: BrowserContext; page: Page }> {
    if (this.context && this.page) return { context: this.context, page: this.page };

    const reachable = await isChromeReachable(this.cdpUrl, 2000);
    if (!reachable) {
      throw new Error(`Grok: Chrome not reachable at ${this.cdpUrl}. Start with --remote-debugging-port=9333.`);
    }

    const wsUrl = await getChromeWebSocketUrl(this.cdpUrl, 5000);
    if (!wsUrl) throw new Error(`Grok: cannot get WebSocket URL`);

    const browser = await chromium.connectOverCDP(wsUrl);
    this.context = browser.contexts()[0];
    if (!this.context) this.context = await browser.newContext();

    const pages = this.context.pages();
    this.page = pages.find(p => p.url().includes("grok.com")) ?? null;
    if (!this.page) {
      this.page = await this.context.newPage();
      await this.page.goto("https://grok.com", { waitUntil: "domcontentloaded" });
    }

    if (this.cookie) {
      const cookies = this.cookie.split(";").map(c => {
        const [name, ...valueParts] = c.trim().split("=");
        return { name: name.trim(), value: valueParts.join("=").trim(), domain: ".grok.com", path: "/" };
      }).filter(c => c.name);
      if (cookies.length > 0) await this.context.addCookies(cookies).catch(() => {});
    }

    return { context: this.context, page: this.page };
  }
}
