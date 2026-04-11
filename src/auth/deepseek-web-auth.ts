/**
 * DeepSeek Web Auth — capture cookie + bearer + PoW session.
 * Ported from openclaw-zero-token/src/zero-token/providers/deepseek-web-auth.ts
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

export interface DeepSeekWebAuthResult extends AuthResult {
  extra: {
    bearer: string;
    deviceId: string;
  };
}

export async function loginDeepSeekWeb(opts: AuthOptions): Promise<DeepSeekWebAuthResult> {
  let capturedBearer = "";

  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://chat.deepseek.com/",
      cookieDomain: "deepseek.com",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "deepseek.com");
        const cookieStr = formatCookies(cookies);

        const hasDeviceId = cookieStr.includes("d_id=");
        const hasSessionId = cookieStr.includes("ds_session_id=");
        const hasSessionInfo = cookieStr.includes("HWSID=") || cookieStr.includes("uuid=");

        if ((hasDeviceId || hasSessionId || hasSessionInfo || cookies.length > 3) && cookieStr.length > 10) {
          // Try to get bearer from page
          try {
            const bearer = await page.evaluate(() => {
              const storage = localStorage.getItem("user");
              if (storage) {
                try {
                  const user = JSON.parse(storage);
                  return user.token || "";
                } catch { return ""; }
              }
              return "";
            });
            if (bearer) capturedBearer = bearer;
          } catch { /* page may not be ready */ }

          log(opts, "Found existing DeepSeek session!");
          return {
            provider: "deepseek-web",
            cookie: cookieStr,
            bearer: capturedBearer || undefined,
            userAgent: await page.evaluate(() => navigator.userAgent),
            extra: {
              bearer: capturedBearer,
              deviceId: cookies.find(c => c.name === "d_id")?.value ?? "",
            },
          } as DeepSeekWebAuthResult;
        }
        return null;
      },

      onRequest: async (request) => {
        const url = request.url();
        if (!url.includes("deepseek.com")) return;

        const headers = request.headers();
        const authHeader = headers["authorization"] || headers["x-api-key"];
        if (authHeader?.startsWith("Bearer ")) {
          if (!capturedBearer) {
            log(opts, "Captured bearer token from request.");
            capturedBearer = authHeader.slice(7);
          }
        }
      },

      periodicCheck: async (context, page) => {
        // Try to extract bearer from localStorage
        try {
          const bearer = await page.evaluate(() => {
            const storage = localStorage.getItem("user");
            if (storage) {
              try {
                const user = JSON.parse(storage);
                return user.token || "";
              } catch { return ""; }
            }
            return "";
          });
          if (bearer && !capturedBearer) {
            capturedBearer = bearer;
          }
        } catch { /* ignore */ }

        if (!capturedBearer) return null;

        const cookies = await getCookies(context, "deepseek.com");
        if (cookies.length === 0) return null;

        return {
          provider: "deepseek-web",
          cookie: formatCookies(cookies),
          bearer: capturedBearer,
          userAgent: await page.evaluate(() => navigator.userAgent),
          extra: {
            bearer: capturedBearer,
            deviceId: cookies.find(c => c.name === "d_id")?.value ?? "",
          },
        } as DeepSeekWebAuthResult;
      },
    },
  ) as Promise<DeepSeekWebAuthResult>;
}
