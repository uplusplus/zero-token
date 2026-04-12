/// <reference lib="dom" />
/**
 * GLM International Web Provider (chat.z.ai) — cookie + DOM interaction via Playwright CDP.
 * Ported from openclaw-zero-token.
 *
 * Uses page.evaluate() to execute fetch within browser context (with cookies),
 * falls back to DOM input+poll if API fails. DOM text is post-processed via
 * TagAwareBuffer for think/tool_call tag extraction.
 */

import crypto from "node:crypto";
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
import { parseGLMIntlSSEStream } from "../streams/glm-parser.js";
import { createTagAwareBuffer } from "../streams/claude-parser.js";

export interface GLMIntlProviderOptions {
  cookie: string;
  userAgent?: string;
  cdpPort?: number;
  cdpUrl?: string;
}

export function createGLMIntlModels(): ModelDefinition[] {
  return [
    {
      id: "glm-4-plus",
      name: "GLM-4 Plus (Intl)",
      provider: "glm-intl-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "glm-4-think",
      name: "GLM-4 Think (Intl)",
      provider: "glm-intl-web",
      reasoning: true,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
    },
  ];
}

export class GLMIntlProvider implements ProviderAdapter {
  readonly id = "glm-intl-web";
  readonly name = "GLM International Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private userAgent: string;
  private cdpPort: number;
  private cdpUrl: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(opts: GLMIntlProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.cdpPort = opts.cdpPort ?? 9333;
    this.cdpUrl = opts.cdpUrl ?? cdpUrlForPort(this.cdpPort);
    this.models = models ?? createGLMIntlModels();
  }

  async init(): Promise<void> {
    await this.ensureBrowser();
    console.log("[glm-intl-web] Initialized");
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

      const model = request.model || "glm-4-plus";

      // Try REST API approach via page.evaluate (with browser cookies)
      const responseData = await page.evaluate(
        async ({ message, model }) => {
          try {
            // Get conversation or create new one
            let conversationId: string | undefined;
            try {
              const listRes = await fetch("https://chat.z.ai/api/conversations", {
                credentials: "include",
              });
              if (listRes.ok) {
                const list = await listRes.json();
                conversationId = list?.data?.[0]?.id ?? list?.[0]?.id;
              }
            } catch { /* ignore */ }

            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            };

            const body: Record<string, unknown> = {
              messages: [{
                role: "user",
                content: message,
              }],
              model,
              stream: true,
            };

            if (conversationId) {
              body.conversation_id = conversationId;
            }

            const res = await fetch("https://chat.z.ai/api/chat/completions", {
              method: "POST",
              headers,
              credentials: "include",
              body: JSON.stringify(body),
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
        // Parse SSE data using enhanced GLM Intl stream parser
        const raw = responseData.data || "";
        const stream = stringToReadableStream(raw);

        for await (const chunk of parseGLMIntlSSEStream(stream)) {
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

      // Fallback to DOM interaction with TagAwareBuffer post-processing
      await this.chatViaDOM(prompt, callbacks);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async chatViaDOM(prompt: string, callbacks: StreamCallbacks): Promise<void> {
    const page = this.page!;

    // Navigate if needed
    if (!page.url().includes("chat.z.ai")) {
      await page.goto("https://chat.z.ai/", { waitUntil: "domcontentloaded", timeout: 120000 });
    }

    // Count assistant messages before sending
    const beforeCount = await page.locator(".chat-assistant").count();

    // Find and fill the input
    let sent = false;

    // Try textarea first
    const textarea = page.locator("textarea").first();
    if ((await textarea.count()) > 0) {
      await textarea.click({ timeout: 5000 });
      await textarea.fill(prompt);
      await textarea.press("Enter");
      sent = true;
    }

    // Fallback to contenteditable
    if (!sent) {
      const editable = page.locator('[contenteditable="true"]').first();
      if ((await editable.count()) > 0) {
        await editable.click({ timeout: 5000 });
        await page.keyboard.type(prompt, { delay: 5 });
        await page.keyboard.press("Enter");
        sent = true;
      }
    }

    if (!sent) {
      throw new Error("GLM Intl: no chat input found on page");
    }

    // Wait for new assistant message
    await page.waitForFunction(
      (prev: number) => document.querySelectorAll(".chat-assistant").length > prev,
      beforeCount,
      { timeout: 120000, polling: 500 },
    ).catch(() => {});

    // Poll until text stabilizes
    const deadline = Date.now() + 120000;
    let stableRounds = 0;
    let lastText = "";

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 900));

      const text = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll(".chat-assistant"));
        const latest = nodes[nodes.length - 1] as HTMLElement | undefined;
        return (latest?.innerText ?? "").trim();
      });

      if (text && text === lastText) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastText = text;
      }

      if (lastText && stableRounds >= 3) break;
    }

    if (!lastText) {
      throw new Error("GLM Intl: no response detected");
    }

    // Post-process DOM text through TagAwareBuffer for think/tool_call extraction
    const tagBuffer = createTagAwareBuffer();
    let emitted = false;
    for (const chunk of tagBuffer.push(lastText)) {
      emitted = true;
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
      }
    }
    for (const chunk of tagBuffer.flush()) {
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
      }
    }

    // If TagAwareBuffer didn't emit anything (plain text, no tags), emit raw
    if (!emitted) {
      callbacks.onText(lastText);
    }

    callbacks.onDone();
  }

  private async ensureBrowser(): Promise<{ context: BrowserContext; page: Page }> {
    if (this.context && this.page) {
      return { context: this.context, page: this.page };
    }

    const reachable = await isChromeReachable(this.cdpUrl, 2000);
    if (!reachable) {
      throw new Error(
        `GLM Intl: Chrome not reachable at ${this.cdpUrl}. ` +
        "Start Chrome with --remote-debugging-port=9333.",
      );
    }

    const wsUrl = await getChromeWebSocketUrl(this.cdpUrl, 5000);
    if (!wsUrl) {
      throw new Error(`GLM Intl: cannot get WebSocket URL from ${this.cdpUrl}`);
    }

    const browser = await chromium.connectOverCDP(wsUrl);
    this.context = browser.contexts()[0];
    if (!this.context) {
      this.context = await browser.newContext();
    }

    const pages = this.context.pages();
    this.page = pages.find((p) => p.url().includes("chat.z.ai")) ?? null;
    if (!this.page) {
      this.page = await this.context.newPage();
      await this.page.goto("https://chat.z.ai/", { waitUntil: "domcontentloaded", timeout: 120000 });
    }

    if (this.cookie) {
      const cookies = this.cookie.split(";").map((c) => {
        const [name, ...valueParts] = c.trim().split("=");
        return {
          name: name.trim(),
          value: valueParts.join("=").trim(),
          domain: ".z.ai",
          path: "/",
        };
      }).filter((c) => c.name);
      if (cookies.length > 0) {
        await this.context.addCookies(cookies).catch(() => {});
      }
    }

    return { context: this.context, page: this.page };
  }
}
