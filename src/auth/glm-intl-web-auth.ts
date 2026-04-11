/**
 * GLM (International) Web Auth — capture cookie via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/glm-intl-web-auth.ts
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

export async function loginGlmIntlWeb(opts: AuthOptions): Promise<AuthResult> {
  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://chat.z.ai/",
      cookieDomain: "z.ai",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "z.ai");
        const hasSession = cookies.some(
          c => c.name === "session_id" || c.name === "token" || c.name.startsWith("glm_"),
        );

        if (hasSession && cookies.length > 2) {
          log(opts, "Found existing GLM Intl session!");
          return {
            provider: "glm-intl-web",
            cookie: formatCookies(cookies),
            userAgent: await page.evaluate(() => navigator.userAgent),
          };
        }
        return null;
      },

      periodicCheck: async (context, page) => {
        const cookies = await getCookies(context, "z.ai");
        const hasSession = cookies.some(
          c => c.name === "session_id" || c.name === "token" || c.name.startsWith("glm_"),
        );

        if (!hasSession) return null;

        return {
          provider: "glm-intl-web",
          cookie: formatCookies(cookies),
          userAgent: await page.evaluate(() => navigator.userAgent),
        };
      },
    },
  );
}
