/**
 * Gemini Web Auth — capture cookie via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/gemini-web-auth.ts
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

export async function loginGeminiWeb(opts: AuthOptions): Promise<AuthResult> {
  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://gemini.google.com/",
      cookieDomain: "google.com",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "google.com");
        const hasSession = cookies.some(
          c => c.name === "SID" || c.name === "SSID" || c.name === "__Secure-1PSID",
        );

        if (hasSession) {
          log(opts, "Found existing Google/Gemini session!");
          return {
            provider: "gemini-web",
            cookie: formatCookies(cookies),
            userAgent: await page.evaluate(() => navigator.userAgent),
          };
        }
        return null;
      },

      periodicCheck: async (context, page) => {
        const cookies = await getCookies(context, "google.com");
        const hasSession = cookies.some(
          c => c.name === "SID" || c.name === "SSID" || c.name === "__Secure-1PSID",
        );

        if (!hasSession) return null;

        return {
          provider: "gemini-web",
          cookie: formatCookies(cookies),
          userAgent: await page.evaluate(() => navigator.userAgent),
        };
      },
    },
  );
}
