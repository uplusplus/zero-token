/**
 * Claude Web Auth — capture cookie + sessionKey via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/claude-web-auth.ts
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

export interface ClaudeWebAuthResult extends AuthResult {
  extra: {
    sessionKey: string;
    organizationId?: string;
  };
}

export async function loginClaudeWeb(opts: AuthOptions): Promise<ClaudeWebAuthResult> {
  let capturedSessionKey = "";

  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://claude.ai/",
      cookieDomain: "claude.ai",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "claude.ai");
        const cookieStr = formatCookies(cookies);

        const sessionKeyCookie = cookies.find(
          c => c.value.startsWith("sk-ant-sid01-") || c.value.startsWith("sk-ant-sid02-"),
        );

        if (sessionKeyCookie) {
          log(opts, "Found existing Claude session!");
          return {
            provider: "claude-web",
            cookie: cookieStr,
            userAgent: await page.evaluate(() => navigator.userAgent),
            extra: { sessionKey: sessionKeyCookie.value },
          } as ClaudeWebAuthResult;
        }
        return null;
      },

      onRequest: async (request) => {
        const url = request.url();
        if (!url.includes("claude.ai")) return;

        const cookie = request.headers()["cookie"];
        if (!cookie) return;

        const match = cookie.match(/sessionKey=([^;]+)/);
        if (
          match &&
          (match[1].startsWith("sk-ant-sid01-") || match[1].startsWith("sk-ant-sid02-"))
        ) {
          if (!capturedSessionKey) {
            log(opts, "Captured sessionKey from request.");
            capturedSessionKey = match[1];
          }
        }
      },

      periodicCheck: async (context, page) => {
        if (!capturedSessionKey) return null;

        const cookies = await getCookies(context, "claude.ai");
        if (cookies.length === 0) return null;

        const cookieStr = formatCookies(cookies);
        return {
          provider: "claude-web",
          cookie: cookieStr,
          userAgent: await page.evaluate(() => navigator.userAgent),
          extra: { sessionKey: capturedSessionKey },
        } as ClaudeWebAuthResult;
      },
    },
  ) as Promise<ClaudeWebAuthResult>;
}
