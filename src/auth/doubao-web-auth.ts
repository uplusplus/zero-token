/**
 * Doubao Web Auth — capture sessionid + ttwid via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/doubao-web-auth.ts
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

export interface DoubaoWebAuthResult extends AuthResult {
  extra: {
    sessionId: string;
    ttwid: string;
  };
}

export async function loginDoubaoWeb(opts: AuthOptions): Promise<DoubaoWebAuthResult> {
  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://www.doubao.com/",
      cookieDomain: "doubao.com",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "doubao.com");
        const cookieStr = formatCookies(cookies);

        const sessionId = cookies.find(c => c.name === "sessionid")?.value ?? "";
        const ttwid = cookies.find(c => c.name === "ttwid")?.value ?? "";

        if (sessionId && ttwid) {
          log(opts, "Found existing Doubao session!");
          return {
            provider: "doubao-web",
            cookie: cookieStr,
            userAgent: await page.evaluate(() => navigator.userAgent),
            extra: { sessionId, ttwid },
          } as DoubaoWebAuthResult;
        }
        return null;
      },

      periodicCheck: async (context, page) => {
        const cookies = await getCookies(context, "doubao.com");
        const sessionId = cookies.find(c => c.name === "sessionid")?.value ?? "";
        const ttwid = cookies.find(c => c.name === "ttwid")?.value ?? "";

        if (!sessionId || !ttwid) return null;

        return {
          provider: "doubao-web",
          cookie: formatCookies(cookies),
          userAgent: await page.evaluate(() => navigator.userAgent),
          extra: { sessionId, ttwid },
        } as DoubaoWebAuthResult;
      },
    },
  ) as Promise<DoubaoWebAuthResult>;
}
