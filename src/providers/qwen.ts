/**
 * Qwen Web Provider (international) — cookie auth via Playwright CDP.
 * Ported from openclaw-zero-token.
 *
 * Uses page.evaluate() to execute fetch within browser context,
 * which bypasses CORS and includes session cookies automatically.
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
import { parseQwenSSEStream } from "../streams/qwen-parser.js";

export interface QwenProviderOptions {
  cookie: string;
  sessionToken?: string;
  userAgent?: string;
  cdpPort?: number;
  cdpUrl?: string;
}

export function createQwenModels(): ModelDefinition[] {
  return [
    {
      id: "qwen3.5-plus",
      name: "Qwen 3.5 Plus",
      provider: "qwen-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "qwen3.5-turbo",
      name: "Qwen 3.5 Turbo",
      provider: "qwen-web",
      reasoning: false,
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 8192,
    },
    {
      id: "qwen3.5-max",
      name: "Qwen 3.5 Max",
      provider: "qwen-web",
      reasoning: true,
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 16384,
    },
  ];
}

const BASE_URL = "https://chat.qwen.ai";

export class QwenProvider implements ProviderAdapter {
  readonly id = "qwen-web";
  readonly name = "Qwen Web";
  readonly models: ModelDefinition[];

  private cookie: string;
  private sessionToken: string;
  private userAgent: string;
  private cdpPort: number;
  private cdpUrl: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private chatIdMap = new Map<string, string>();

  constructor(opts: QwenProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.sessionToken = opts.sessionToken ?? "";
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.cdpPort = opts.cdpPort ?? 9333;
    this.cdpUrl = opts.cdpUrl ?? cdpUrlForPort(this.cdpPort);
    this.models = models ?? createQwenModels();
  }

  async init(): Promise<void> {
    await this.ensureBrowser();
    console.log("[qwen-web] Initialized");
  }

  async close(): Promise<void> {
    this.chatIdMap.clear();
    // Don't close the browser — other providers may share it
    this.page = null;
    this.context = null;
  }

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      const { page } = await this.ensureBrowser();
      const prompt = buildPrompt(request.messages);
      if (!prompt) throw new Error("No message to send");

      // Step 1: Create a new chat
      const createResult = await page.evaluate(
        async ({ baseUrl }) => {
          try {
            const res = await fetch(`${baseUrl}/api/v2/chats/new`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            if (!res.ok) return { ok: false, status: res.status, error: await res.text() };
            const data = await res.json();
            const chatId = data.data?.id ?? data.chat_id ?? data.id;
            return { ok: true, chatId };
          } catch (err) {
            return { ok: false, status: 500, error: String(err) };
          }
        },
        { baseUrl: BASE_URL },
      );

      if (!createResult.ok || !createResult.chatId) {
        throw new Error(`Qwen: failed to create chat: ${createResult.error}`);
      }

      const chatId = createResult.chatId;

      // Step 2: Send message and collect streaming response
      const model = request.model || "qwen3.5-plus";
      const fid = crypto.randomUUID();

      // Take only the last user message (Qwen expects raw user input)
      const userMessages = request.messages.filter(m => m.role === "user");
      const lastUserMsg = userMessages[userMessages.length - 1];
      const rawContent = lastUserMsg
        ? (typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : (lastUserMsg.content || []).filter(p => p.type === "text").map(p => p.text).join(""))
        : prompt;

      const responseData = await page.evaluate(
        async ({ baseUrl, chatId, model, message, fid }) => {
          try {
            const url = `${baseUrl}/api/v2/chat/completions?chat_id=${chatId}`;
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
              },
              body: JSON.stringify({
                stream: true,
                version: "2.1",
                incremental_output: true,
                chat_id: chatId,
                chat_mode: "normal",
                model,
                parent_id: null,
                messages: [{
                  fid,
                  parentId: null,
                  childrenIds: [],
                  role: "user",
                  content: message,
                  user_action: "chat",
                  files: [],
                  timestamp: Math.floor(Date.now() / 1000),
                  models: [model],
                  chat_type: "t2t",
                  feature_config: { thinking_enabled: true, output_schema: "phase" },
                }],
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
        { baseUrl: BASE_URL, chatId, model, message: rawContent, fid },
      );

      if (!responseData.ok) {
        throw new Error(`Qwen API error: ${responseData.status} - ${responseData.error}`);
      }

      // Parse the collected SSE data using enhanced Qwen stream parser
      const raw = responseData.data || "";
      const stream = stringToReadableStream(raw);

      for await (const chunk of parseQwenSSEStream(stream)) {
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
        `Qwen: Chrome not reachable at ${this.cdpUrl}. ` +
        "Start Chrome with --remote-debugging-port=9333 or configure browser profile.",
      );
    }

    const wsUrl = await getChromeWebSocketUrl(this.cdpUrl, 5000);
    if (!wsUrl) {
      throw new Error(`Qwen: cannot get WebSocket URL from ${this.cdpUrl}`);
    }

    const browser = await chromium.connectOverCDP(wsUrl);
    this.context = browser.contexts()[0];
    if (!this.context) {
      this.context = await browser.newContext();
    }

    // Find or create Qwen page
    const pages = this.context.pages();
    this.page = pages.find((p) => p.url().includes("qwen.ai")) ?? null;
    if (!this.page) {
      this.page = await this.context.newPage();
      await this.page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    }

    // Inject cookies if provided
    if (this.cookie) {
      const cookies = this.cookie.split(";").map((c) => {
        const [name, ...valueParts] = c.trim().split("=");
        return {
          name: name.trim(),
          value: valueParts.join("=").trim(),
          domain: ".qwen.ai",
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
