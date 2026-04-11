/**
 * Qwen (International) Web Auth — capture cookie + session token via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/qwen-web-auth.ts
 */

import type { BrowserContext, Page } from "playwright-core";
import {
  runAuthFlow,
  getCookies,
  formatCookies,
  log,
  type AuthResult,
  type AuthOptions,
} from "./base.js";

export interface QwenWebAuthResult extends AuthResult {
  extra: {
    token: string;
    deviceId: string;
  };
}

export async function loginQwenWeb(opts: AuthOptions): Promise<QwenWebAuthResult> {
  let capturedToken = "";

  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://chat.qwen.ai/",
      cookieDomain: "qwen.ai",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "qwen.ai");
        const tokenCookie = cookies.find(c => c.name === "token" || c.name === "session_token");

        if (tokenCookie) {
          log(opts, "Found existing Qwen session!");
          return {
            provider: "qwen-web",
            cookie: formatCookies(cookies),
            userAgent: await page.evaluate(() => navigator.userAgent),
            extra: {
              token: tokenCookie.value,
              deviceId: cookies.find(c => c.name === "device_id")?.value ?? "",
            },
          } as QwenWebAuthResult;
        }
        return null;
      },

      onRequest: async (request) => {
        const url = request.url();
        if (!url.includes("qwen.ai")) return;

        const headers = request.headers();
        const authHeader = headers["authorization"];
        if (authHeader?.startsWith("Bearer ")) {
          if (!capturedToken) {
            log(opts, "Captured Qwen bearer token.");
            capturedToken = authHeader.slice(7);
          }
        }
      },

      periodicCheck: async (context, page) => {
        if (!capturedToken) return null;

        const cookies = await getCookies(context, "qwen.ai");
        if (cookies.length === 0) return null;

        return {
          provider: "qwen-web",
          cookie: formatCookies(cookies),
          bearer: capturedToken,
          userAgent: await page.evaluate(() => navigator.userAgent),
          extra: {
            token: capturedToken,
            deviceId: cookies.find(c => c.name === "device_id")?.value ?? "",
          },
        } as QwenWebAuthResult;
      },
    },
  ) as Promise<QwenWebAuthResult>;
}
