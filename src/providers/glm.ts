/**
 * GLM Web Provider (智谱清言 chatglm.cn) — cookie + X-Sign auth via Playwright CDP.
 * Ported from openclaw-zero-token.
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
import { parseGLMSSEStream } from "../streams/glm-parser.js";

export interface GLMProviderOptions {
  cookie: string;
  userAgent?: string;
  cdpPort?: number;
  cdpUrl?: string;
}

export function createGLMModels(): ModelDefinition[] {
  return [
    {
      id: "glm-4-plus",
      name: "GLM-4 Plus",
      provider: "glm-web",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 4096,
    },
    {
      id: "glm-4-think",
      name: "GLM-4 Think",
      provider: "glm-web",
      reasoning: true,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 16384,
    },
  ];
}

const BASE_URL = "https://chatglm.cn";
const SIGN_SECRET = "8a1317a7468aa3ad86e997d08f3f31cb";

const ASSISTANT_ID_MAP: Record<string, string> = {
  "glm-4-plus": "65940acff94777010aa6b796",
  "glm-4": "65940acff94777010aa6b796",
  "glm-4-think": "676411c38945bbc58a905d31",
  "glm-4-zero": "676411c38945bbc58a905d31",
};
const DEFAULT_ASSISTANT_ID = "65940acff94777010aa6b796";

const X_EXP_GROUPS =
  "na_android_config:exp:NA,na_4o_config:exp:4o_A,tts_config:exp:tts_config_a," +
  "na_glm4plus_config:exp:open,mainchat_server_app:exp:A,mobile_history_daycheck:exp:a," +
  "desktop_toolbar:exp:A,chat_drawing_server:exp:A,drawing_server_cogview:exp:cogview4," +
  "app_welcome_v2:exp:A,chat_drawing_streamv2:exp:A,mainchat_rm_fc:exp:add," +
  "mainchat_dr:exp:open,chat_auto_entrance:exp:A,drawing_server_hi_dream:control:A," +
  "homepage_square:exp:close,assistant_recommend_prompt:exp:3,app_home_regular_user:exp:A," +
  "memory_common:exp:enable,mainchat_moe:exp:300,assistant_greet_user:exp:greet_user," +
  "app_welcome_personalize:exp:A,assistant_model_exp_group:exp:glm4.5," +
  "ai_wallet:exp:ai_wallet_enable";

function generateSign(): { timestamp: string; nonce: string; sign: string } {
  const e = Date.now();
  const A = e.toString();
  const t = A.length;
  const o = A.split("").map((c) => Number(c));
  const i = o.reduce((acc, v) => acc + v, 0) - o[t - 2];
  const a = i % 10;
  const timestamp = A.substring(0, t - 2) + a + A.substring(t - 1, t);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const sign = crypto
    .createHash("md5")
    .update(`${timestamp}-${nonce}-${SIGN_SECRET}`)
    .digest("hex");
  return { timestamp, nonce, sign };
}

export class GLMProvider implements ProviderAdapter {
  readonly id = "glm-web";
  readonly name = "GLM Web (智谱清言)";
  readonly models: ModelDefinition[];

  private cookie: string;
  private userAgent: string;
  private cdpPort: number;
  private cdpUrl: string;
  private deviceId: string;
  private accessToken: string | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(opts: GLMProviderOptions, models?: ModelDefinition[]) {
    this.cookie = opts.cookie;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.cdpPort = opts.cdpPort ?? 9333;
    this.cdpUrl = opts.cdpUrl ?? cdpUrlForPort(this.cdpPort);
    this.deviceId = crypto.randomUUID().replace(/-/g, "");
    this.models = models ?? createGLMModels();
  }

  async init(): Promise<void> {
    await this.ensureBrowser();
    await this.refreshAccessToken();
    console.log("[glm-web] Initialized");
  }

  async close(): Promise<void> {
    this.page = null;
    this.context = null;
    this.accessToken = null;
  }

  async chat(request: ChatCompletionRequest, callbacks: StreamCallbacks): Promise<void> {
    try {
      const { page } = await this.ensureBrowser();

      if (!this.accessToken) {
        await this.refreshAccessToken();
      }

      const prompt = buildPrompt(request.messages);
      if (!prompt) throw new Error("No message to send");

      const model = request.model || "glm-4-plus";
      const assistantId = ASSISTANT_ID_MAP[model] ?? DEFAULT_ASSISTANT_ID;
      const sign = generateSign();
      const requestId = crypto.randomUUID().replace(/-/g, "");

      const body = {
        assistant_id: assistantId,
        conversation_id: "",
        project_id: "",
        chat_type: "user_chat",
        meta_data: {
          cogview: { rm_label_watermark: false },
          is_test: false,
          input_question_type: "xxxx",
          channel: "",
          draft_id: "",
          chat_mode: "zero",
          is_networking: false,
          quote_log_id: "",
          platform: "pc",
        },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
      };

      const responseData = await page.evaluate(
        async ({ accessToken, bodyStr, deviceId, requestId, sign, xExpGroups }) => {
          try {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              "App-Name": "chatglm",
              Origin: "https://chatglm.cn",
              "X-App-Platform": "pc",
              "X-App-Version": "0.0.1",
              "X-App-fr": "default",
              "X-Device-Brand": "",
              "X-Device-Id": deviceId,
              "X-Device-Model": "",
              "X-Exp-Groups": xExpGroups,
              "X-Lang": "zh",
              "X-Nonce": sign.nonce,
              "X-Request-Id": requestId,
              "X-Sign": sign.sign,
              "X-Timestamp": sign.timestamp,
            };
            if (accessToken) {
              headers["Authorization"] = `Bearer ${accessToken}`;
            }

            const res = await fetch("https://chatglm.cn/chatglm/backend-api/assistant/stream", {
              method: "POST",
              headers,
              credentials: "include",
              body: bodyStr,
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
          accessToken: this.accessToken,
          bodyStr: JSON.stringify(body),
          deviceId: this.deviceId,
          requestId,
          sign,
          xExpGroups: X_EXP_GROUPS,
        },
      );

      if (!responseData.ok) {
        if (responseData.status === 401) {
          await this.refreshAccessToken();
          throw new Error("GLM: auth expired, token refreshed. Please retry.");
        }
        throw new Error(`GLM API error: ${responseData.status} - ${responseData.error}`);
      }

      // Parse SSE response using enhanced GLM stream parser
      const raw = responseData.data || "";
      const stream = stringToReadableStream(raw);

      for await (const chunk of parseGLMSSEStream(stream)) {
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
        `GLM: Chrome not reachable at ${this.cdpUrl}. ` +
        "Start Chrome with --remote-debugging-port=9333.",
      );
    }

    const wsUrl = await getChromeWebSocketUrl(this.cdpUrl, 5000);
    if (!wsUrl) {
      throw new Error(`GLM: cannot get WebSocket URL from ${this.cdpUrl}`);
    }

    const browser = await chromium.connectOverCDP(wsUrl);
    this.context = browser.contexts()[0];
    if (!this.context) {
      this.context = await browser.newContext();
    }

    const pages = this.context.pages();
    this.page = pages.find((p) => p.url().includes("chatglm.cn")) ?? null;
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
          domain: ".chatglm.cn",
          path: "/",
        };
      }).filter((c) => c.name);
      if (cookies.length > 0) {
        await this.context.addCookies(cookies).catch(() => {});
      }
    }

    return { context: this.context, page: this.page };
  }

  private async refreshAccessToken(): Promise<void> {
    // Try to get token from cookie
    if (this.cookie) {
      const match = this.cookie.match(/chatglm_token=([^;]+)/);
      if (match) {
        this.accessToken = match[1].trim();
        return;
      }
    }

    // Try refresh via API
    const refreshToken = this.cookie.match(/chatglm_refresh_token=([^;]+)/)?.[1];
    if (!refreshToken || !this.page) return;

    const sign = generateSign();
    const requestId = crypto.randomUUID().replace(/-/g, "");

    const result = await this.page.evaluate(
      async ({ refreshToken, deviceId, requestId, sign }) => {
        try {
          const res = await fetch("https://chatglm.cn/chatglm/user-api/user/refresh", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${refreshToken}`,
              "App-Name": "chatglm",
              "X-App-Platform": "pc",
              "X-App-Version": "0.0.1",
              "X-Device-Id": deviceId,
              "X-Request-Id": requestId,
              "X-Sign": sign.sign,
              "X-Nonce": sign.nonce,
              "X-Timestamp": sign.timestamp,
            },
            credentials: "include",
            body: JSON.stringify({}),
          });
          if (!res.ok) return { ok: false, error: await res.text() };
          const data = await res.json();
          const accessToken = data?.result?.access_token ?? data?.result?.accessToken;
          return accessToken ? { ok: true, accessToken } : { ok: false, error: "no token" };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
      { refreshToken, deviceId: this.deviceId, requestId, sign },
    );

    if (result.ok && result.accessToken) {
      this.accessToken = result.accessToken;
    }
  }
}
