/// <reference lib="dom" />
/**
 * Perplexity Web Provider — cookie + DOM interaction via Playwright CDP.
 * Ported from openclaw-zero-token.
 *
 * Uses page.evaluate() to execute fetch within browser context (with cookies),
 * falls back to DOM input+poll if API fails.
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
import { parsePerplexitySSEStream } from "../streams/perplexity-parser.js";

export interface PerplexityProviderOptions {
  cookie: string;
  userAgent?: string;
  cdpPort?: number;
  cdpUrl?: string;
}

export function createPerplexityModels(): ModelDefinition[] {
  return [
    {
      id: "perplexity-web",
      name: "Perplexity (Sonar)",
      provider: "perplexity-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "perplexity-pro",
      name: "Perplexity Pro",
      provider: "perplexity-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 8192,
    },
  ];
}

const BASE_URL = "https://www.perplexity.ai";

export class PerplexityProvider implements ProviderAdapter {
  readonly id = "perplexity-web";
  readonly name = "Perplexity Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private userAgent: string;
  private cdpPort: number;
  private cdpUrl: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(opts: PerplexityProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.cdpPort = opts.cdpPort ?? 9333;
    this.cdpUrl = opts.cdpUrl ?? cdpUrlForPort(this.cdpPort);
    this.models = models ?? createPerplexityModels();
  }

  async init(): Promise<void> {
    await this.ensureBrowser();
    console.log("[perplexity-web] Initialized");
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

      const model = request.model || "perplexity-web";

      // Try REST API approach via page.evaluate (with browser cookies)
      const responseData = await page.evaluate(
        async ({ message, model }) => {
          try {
            const uuid = () => crypto.randomUUID();

            const res = await fetch("https://www.perplexity.ai/rest/search", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
              },
              credentials: "include",
              body: JSON.stringify({
                query_str: message,
                source: "default",
                version: "2.18",
                language: "en-US",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                search_focus: "internet",
                frontend_uuid: uuid(),
                mode: model === "perplexity-pro" ? "pro" : "default",
              }),
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
        // Parse SSE data using enhanced Perplexity stream parser
        const raw = responseData.data || "";
        const stream = stringToReadableStream(raw);

        for await (const chunk of parsePerplexitySSEStream(stream)) {
          switch (chunk.type) {
            case "text":
              if (chunk.content) callbacks.onText(chunk.content);
              break;
            case "thinking":
              if (chunk.content) callbacks.onReasoning(chunk.content);
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
      await this.chatViaDOM(prompt, callbacks);
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async chatViaDOM(prompt: string, callbacks: StreamCallbacks): Promise<void> {
    const page = this.page!;

    // Click "New Thread" or navigate to home
    const newThreadBtn = await page.$(
      'button:has-text("New Thread"), button:has-text("新建问题"), a:has-text("New Thread")',
    );
    if (newThreadBtn) {
      await newThreadBtn.click();
      await page.waitForTimeout(1500);
    } else {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
    }

    // Find input
    const inputSel = 'div[contenteditable="true"], [role="textbox"], textarea';
    const inputHandle = await page.$(inputSel);
    if (!inputHandle) {
      throw new Error("Perplexity: input element not found");
    }

    await inputHandle.click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(200);
    await page.keyboard.type(prompt, { delay: 20 });
    await page.waitForTimeout(500);

    const urlBefore = page.url();
    await page.keyboard.press("Enter");

    // Wait for URL change (new search creates new URL)
    try {
      await page.waitForURL(
        (url) => url.href !== urlBefore &&
          (url.pathname.startsWith("/search/") || url.pathname.startsWith("/c/")),
        { timeout: 15000 },
      );
    } catch { /* ignore */ }

    // Poll for response content
    const maxWaitMs = 120000;
    const pollInterval = 3000;
    let lastText = "";
    let stableCount = 0;

    for (let elapsed = 0; elapsed < maxWaitMs; elapsed += pollInterval) {
      await page.waitForTimeout(pollInterval);

      const text = await page.evaluate(() => {
        const clean = (t: string) => t.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        const selectors = [
          '[class*="prose"]',
          '[class*="break-words"][class*="font-sans"]',
          '[class*="markdown"]',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          for (let i = els.length - 1; i >= 0; i--) {
            const t = clean((els[i] as HTMLElement).innerText ?? "");
            if (t.length >= 2) return t;
          }
        }
        return "";
      });

      if (text && text.length >= 2) {
        if (text !== lastText) {
          lastText = text;
          stableCount = 0;
        } else {
          stableCount++;
          if (stableCount >= 2) break;
        }
      }
    }

    if (!lastText) {
      throw new Error("Perplexity: no response detected");
    }

    callbacks.onText(lastText);
    callbacks.onDone();
  }

  private async ensureBrowser(): Promise<{ context: BrowserContext; page: Page }> {
    if (this.context && this.page) {
      return { context: this.context, page: this.page };
    }

    const reachable = await isChromeReachable(this.cdpUrl, 2000);
    if (!reachable) {
      throw new Error(
        `Perplexity: Chrome not reachable at ${this.cdpUrl}. ` +
        "Start Chrome with --remote-debugging-port=9333.",
      );
    }

    const wsUrl = await getChromeWebSocketUrl(this.cdpUrl, 5000);
    if (!wsUrl) {
      throw new Error(`Perplexity: cannot get WebSocket URL`);
    }

    const browser = await chromium.connectOverCDP(wsUrl);
    this.context = browser.contexts()[0];
    if (!this.context) {
      this.context = await browser.newContext();
    }

    const pages = this.context.pages();
    this.page = pages.find((p) => p.url().includes("perplexity.ai")) ?? null;
    if (!this.page) {
      this.page = await this.context.newPage();
      await this.page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    }

    if (this.cookie) {
      const cookies = this.cookie.split(";").map((c) => {
        const [name, ...valueParts] = c.trim().split("=");
        return {
          name: name.trim(),
          value: valueParts.join("=").trim(),
          domain: ".perplexity.ai",
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
