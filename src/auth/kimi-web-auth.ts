/**
 * Kimi Web Auth — capture bearer (kimi-auth) via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/kimi-web-auth.ts
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

export interface KimiWebAuthResult extends AuthResult {
  extra: {
    bearer: string;
  };
}

export async function loginKimiWeb(opts: AuthOptions): Promise<KimiWebAuthResult> {
  let capturedBearer = "";

  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://kimi.moonshot.cn/",
      cookieDomain: "moonshot.cn",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "moonshot.cn");
        const authCookie = cookies.find(c => c.name === "kimi-auth" || c.name === "kimi_token");

        if (authCookie) {
          log(opts, "Found existing Kimi session!");
          return {
            provider: "kimi-web",
            cookie: formatCookies(cookies),
            bearer: authCookie.value,
            userAgent: await page.evaluate(() => navigator.userAgent),
            extra: { bearer: authCookie.value },
          } as KimiWebAuthResult;
        }
        return null;
      },

      onRequest: async (request) => {
        const url = request.url();
        if (!url.includes("moonshot.cn") && !url.includes("kimi")) return;

        const headers = request.headers();
        const authHeader = headers["authorization"] || headers["x-kimi-auth"];
        if (authHeader?.startsWith("Bearer ")) {
          if (!capturedBearer) {
            log(opts, "Captured Kimi bearer token.");
            capturedBearer = authHeader.slice(7);
          }
        }
        // Also check cookie header
        const cookie = headers["cookie"];
        if (cookie) {
          const match = cookie.match(/kimi-auth=([^;]+)/);
          if (match && !capturedBearer) {
            capturedBearer = match[1];
          }
        }
      },

      periodicCheck: async (context, page) => {
        if (!capturedBearer) return null;

        const cookies = await getCookies(context, "moonshot.cn");
        return {
          provider: "kimi-web",
          cookie: formatCookies(cookies),
          bearer: capturedBearer,
          userAgent: await page.evaluate(() => navigator.userAgent),
          extra: { bearer: capturedBearer },
        } as KimiWebAuthResult;
      },
    },
  ) as Promise<KimiWebAuthResult>;
}
