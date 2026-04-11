/**
 * Grok Web Auth — capture cookie via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/grok-web-auth.ts
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

export async function loginGrokWeb(opts: AuthOptions): Promise<AuthResult> {
  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://grok.com/",
      cookieDomain: "grok.com",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "grok.com");
        const hasSession = cookies.some(
          c => c.name === "auth_token" || c.name === "auth_token_v2" || c.name === "ct0",
        );

        if (hasSession) {
          log(opts, "Found existing Grok session!");
          return {
            provider: "grok-web",
            cookie: formatCookies(cookies),
            userAgent: await page.evaluate(() => navigator.userAgent),
          };
        }
        return null;
      },

      periodicCheck: async (context, page) => {
        const cookies = await getCookies(context, "grok.com");
        const hasSession = cookies.some(
          c => c.name === "auth_token" || c.name === "auth_token_v2" || c.name === "ct0",
        );

        if (!hasSession) return null;

        return {
          provider: "grok-web",
          cookie: formatCookies(cookies),
          userAgent: await page.evaluate(() => navigator.userAgent),
        };
      },
    },
  );
}
