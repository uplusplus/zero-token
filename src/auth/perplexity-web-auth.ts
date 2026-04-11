/**
 * Perplexity Web Auth — capture cookie via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/perplexity-web-auth.ts
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

export async function loginPerplexityWeb(opts: AuthOptions): Promise<AuthResult> {
  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://www.perplexity.ai/",
      cookieDomain: "perplexity.ai",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "perplexity.ai");
        const hasSession = cookies.some(
          c => c.name === "__Secure-next-auth.session-token" ||
               c.name === "next-auth.session-token" ||
               c.name === "session",
        );

        if (hasSession) {
          log(opts, "Found existing Perplexity session!");
          return {
            provider: "perplexity-web",
            cookie: formatCookies(cookies),
            userAgent: await page.evaluate(() => navigator.userAgent),
          };
        }
        return null;
      },

      periodicCheck: async (context, page) => {
        const cookies = await getCookies(context, "perplexity.ai");
        const hasSession = cookies.some(
          c => c.name === "__Secure-next-auth.session-token" ||
               c.name === "next-auth.session-token" ||
               c.name === "session",
        );

        if (!hasSession) return null;

        return {
          provider: "perplexity-web",
          cookie: formatCookies(cookies),
          userAgent: await page.evaluate(() => navigator.userAgent),
        };
      },
    },
  );
}
