/**
 * Xiaomi MiMo Web Auth — capture cookie + bearer via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/xiaomimo-web-auth.ts
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

export interface XiaomiMiMoWebAuthResult extends AuthResult {
  extra: {
    bearer: string;
    userId: string;
  };
}

export async function loginXiaomiMiMoWeb(opts: AuthOptions): Promise<XiaomiMiMoWebAuthResult> {
  let capturedBearer = "";

  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://mimo.xiaomi.com/",
      cookieDomain: "mimo.xiaomi.com",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "mimo.xiaomi.com");
        const authCookie = cookies.find(c => c.name === "auth_token" || c.name === "xm_auth");

        if (authCookie) {
          log(opts, "Found existing MiMo session!");
          return {
            provider: "xiaomimo-web",
            cookie: formatCookies(cookies),
            bearer: authCookie.value,
            userAgent: await page.evaluate(() => navigator.userAgent),
            extra: {
              bearer: authCookie.value,
              userId: cookies.find(c => c.name === "userId")?.value ?? "",
            },
          } as XiaomiMiMoWebAuthResult;
        }
        return null;
      },

      onRequest: async (request) => {
        const url = request.url();
        if (!url.includes("mimo.xiaomi.com") && !url.includes("xiaomi")) return;

        const headers = request.headers();
        const authHeader = headers["authorization"];
        if (authHeader?.startsWith("Bearer ")) {
          if (!capturedBearer) {
            log(opts, "Captured MiMo bearer token.");
            capturedBearer = authHeader.slice(7);
          }
        }
      },

      periodicCheck: async (context, page) => {
        if (!capturedBearer) return null;

        const cookies = await getCookies(context, "mimo.xiaomi.com");
        return {
          provider: "xiaomimo-web",
          cookie: formatCookies(cookies),
          bearer: capturedBearer,
          userAgent: await page.evaluate(() => navigator.userAgent),
          extra: {
            bearer: capturedBearer,
            userId: cookies.find(c => c.name === "userId")?.value ?? "",
          },
        } as XiaomiMiMoWebAuthResult;
      },
    },
  ) as Promise<XiaomiMiMoWebAuthResult>;
}
