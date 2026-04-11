/**
 * Qwen (China) Web Auth — capture XSRF + session via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/qwen-cn-web-auth.ts
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

export interface QwenCnWebAuthResult extends AuthResult {
  extra: {
    xsrfToken: string;
    deviceId: string;
    token: string;
  };
}

export async function loginQwenCnWeb(opts: AuthOptions): Promise<QwenCnWebAuthResult> {
  let capturedToken = "";

  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://tongyi.aliyun.com/qianwen/",
      cookieDomain: "aliyun.com",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "aliyun.com");
        const cookieStr = formatCookies(cookies);

        const xsrf = cookies.find(c => c.name === "XSRF-TOKEN")?.value ?? "";
        const hasSession = cookies.some(c => c.name === "cna" || c.name === "ALIYUN_DATA");

        if (xsrf && hasSession) {
          log(opts, "Found existing Qwen CN session!");
          return {
            provider: "qwen-cn-web",
            cookie: cookieStr,
            userAgent: await page.evaluate(() => navigator.userAgent),
            extra: {
              xsrfToken: xsrf,
              deviceId: cookies.find(c => c.name === "cna")?.value ?? "",
              token: capturedToken,
            },
          } as QwenCnWebAuthResult;
        }
        return null;
      },

      onRequest: async (request) => {
        const url = request.url();
        if (!url.includes("aliyun.com") && !url.includes("tongyi")) return;

        const headers = request.headers();
        const authHeader = headers["authorization"];
        if (authHeader?.startsWith("Bearer ")) {
          if (!capturedToken) {
            log(opts, "Captured Qwen CN bearer token.");
            capturedToken = authHeader.slice(7);
          }
        }
      },

      periodicCheck: async (context, page) => {
        const cookies = await getCookies(context, "aliyun.com");
        const xsrf = cookies.find(c => c.name === "XSRF-TOKEN")?.value;

        if (!xsrf) return null;

        return {
          provider: "qwen-cn-web",
          cookie: formatCookies(cookies),
          bearer: capturedToken || undefined,
          userAgent: await page.evaluate(() => navigator.userAgent),
          extra: {
            xsrfToken: xsrf,
            deviceId: cookies.find(c => c.name === "cna")?.value ?? "",
            token: capturedToken,
          },
        } as QwenCnWebAuthResult;
      },
    },
  ) as Promise<QwenCnWebAuthResult>;
}
