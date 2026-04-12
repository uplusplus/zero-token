/**
 * Qwen CN Web Provider (国内版 qianwen.com) — cookie + XSRF auth via Playwright CDP.
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
import { parseQwenCNSSEStream } from "../streams/qwen-parser.js";

export interface QwenCNProviderOptions {
  cookie: string;
  xsrfToken?: string;
  userAgent?: string;
  deviceId?: string;
  ut?: string;
  cdpPort?: number;
  cdpUrl?: string;
}

export function createQwenCNModels(): ModelDefinition[] {
  return [
    {
      id: "Qwen3.5-Plus",
      name: "Qwen 3.5 Plus (国内版)",
      provider: "qwen-cn-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "Qwen3.5-Turbo",
      name: "Qwen 3.5 Turbo (国内版)",
      provider: "qwen-cn-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 32768,
      maxTokens: 4096,
    },
  ];
}

const BASE_URL = "https://chat2.qianwen.com";

export class QwenCNProvider implements ProviderAdapter {
  readonly id = "qwen-cn-web";
  readonly name = "Qwen CN Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private xsrfToken: string;
  private userAgent: string;
  private deviceId: string;
  private ut: string;
  private cdpPort: number;
  private cdpUrl: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(opts: QwenCNProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.xsrfToken = opts.xsrfToken ?? "";
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.cdpPort = opts.cdpPort ?? 9333;
    this.cdpUrl = opts.cdpUrl ?? cdpUrlForPort(this.cdpPort);

    // Extract ut from cookie if not provided
    this.ut = opts.ut ?? "";
    if (!this.ut && this.cookie) {
      const match = this.cookie.match(/b-user-id=([^;]+)/);
      if (match) this.ut = match[1].trim();
    }
    this.deviceId = opts.deviceId ?? this.ut ?? `dev-${Math.random().toString(36).slice(2)}`;
    this.models = models ?? createQwenCNModels();
  }

  async init(): Promise<void> {
    await this.ensureBrowser();
    console.log("[qwen-cn-web] Initialized");
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

      const model = request.model || "Qwen3.5-Plus";
      const sessionId = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("");
      const timestamp = Date.now();
      const nonce = Math.random().toString(36).slice(2);

      // Take only the last user message (Qwen CN expects raw user input, not formatted prompt)
      const userMessages = request.messages.filter(m => m.role === "user");
      const lastUserMsg = userMessages[userMessages.length - 1];
      const rawContent = lastUserMsg
        ? (typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : (lastUserMsg.content || []).filter(p => p.type === "text").map(p => p.text).join(""))
        : prompt;

      const responseData = await page.evaluate(
        async ({
          baseUrl, sessionId, model, message, ut, xsrfToken, deviceId, nonce, timestamp,
        }) => {
          try {
            const url = `${baseUrl}/api/v2/chat?biz_id=ai_qwen&chat_client=h5&device=pc&fr=pc&pr=qwen&nonce=${nonce}&timestamp=${timestamp}&ut=${ut}`;

            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream, text/plain, */*",
                Referer: `${baseUrl}/`,
                Origin: baseUrl,
                "x-xsrf-token": xsrfToken,
                "x-deviceid": deviceId,
                "x-platform": "pc_tongyi",
                "x-req-from": "pc_web",
              },
              body: JSON.stringify({
                model,
                messages: [{
                  content: message,
                  mime_type: "text/plain",
                  meta_data: { ori_query: message },
                }],
                session_id: sessionId,
                parent_req_id: "0",
                deep_search: "0",
                req_id: `req-${Math.random().toString(36).slice(2)}`,
                scene: "chat",
                sub_scene: "chat",
                temporary: false,
                from: "default",
                scene_param: "first_turn",
                chat_client: "h5",
                client_tm: timestamp.toString(),
                protocol_version: "v2",
                biz_id: "ai_qwen",
              }),
              credentials: "include",
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
        {
          baseUrl: BASE_URL,
          sessionId,
          model,
          message: rawContent,
          ut: this.ut,
          xsrfToken: this.xsrfToken,
          deviceId: this.deviceId,
          nonce,
          timestamp,
        },
      );

      if (!responseData.ok) {
        throw new Error(`Qwen CN API error: ${responseData.status} - ${responseData.error}`);
      }

      // Parse SSE response using enhanced Qwen CN stream parser
      const raw = responseData.data || "";
      const stream = stringToReadableStream(raw);

      for await (const chunk of parseQwenCNSSEStream(stream)) {
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
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async ensureBrowser(): Promise<{ context: BrowserContext; page: Page }> {
    if (this.context && this.page) {
      return { context: this.context, page: this.page };
    }

    const reachable = await isChromeReachable(this.cdpUrl, 2000);
    if (!reachable) {
      throw new Error(
        `Qwen CN: Chrome not reachable at ${this.cdpUrl}. ` +
        "Start Chrome with --remote-debugging-port=9333.",
      );
    }

    const wsUrl = await getChromeWebSocketUrl(this.cdpUrl, 5000);
    if (!wsUrl) {
      throw new Error(`Qwen CN: cannot get WebSocket URL from ${this.cdpUrl}`);
    }

    const browser = await chromium.connectOverCDP(wsUrl);
    this.context = browser.contexts()[0];
    if (!this.context) {
      this.context = await browser.newContext();
    }

    const pages = this.context.pages();
    this.page = pages.find((p) => p.url().includes("qianwen.com")) ?? null;
    if (!this.page) {
      this.page = await this.context.newPage();
      await this.page.goto("https://www.qianwen.com/", { waitUntil: "domcontentloaded" });
    }

    if (this.cookie) {
      const cookies = this.cookie.split(";").map((c) => {
        const [name, ...valueParts] = c.trim().split("=");
        return {
          name: name.trim(),
          value: valueParts.join("=").trim(),
          domain: ".qianwen.com",
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
