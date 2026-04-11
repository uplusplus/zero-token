/**
 * GLM (Zhipu) Web Auth — capture cookie via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/glm-web-auth.ts
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

export async function loginGlmWeb(opts: AuthOptions): Promise<AuthResult> {
  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://chatglm.cn/",
      cookieDomain: "chatglm.cn",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "chatglm.cn");
        const hasSession = cookies.some(
          c => c.name === "session_id" || c.name === "chatglm_token" || c.name.startsWith("zhipu_"),
        );

        if (hasSession && cookies.length > 2) {
          log(opts, "Found existing GLM session!");
          return {
            provider: "glm-web",
            cookie: formatCookies(cookies),
            userAgent: await page.evaluate(() => navigator.userAgent),
          };
        }
        return null;
      },

      periodicCheck: async (context, page) => {
        const cookies = await getCookies(context, "chatglm.cn");
        const hasSession = cookies.some(
          c => c.name === "session_id" || c.name === "chatglm_token" || c.name.startsWith("zhipu_"),
        );

        if (!hasSession) return null;

        return {
          provider: "glm-web",
          cookie: formatCookies(cookies),
          userAgent: await page.evaluate(() => navigator.userAgent),
        };
      },
    },
  );
}
