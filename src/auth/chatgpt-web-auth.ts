/**
 * ChatGPT Web Auth — capture session + sentinel via CDP.
 * Ported from openclaw-zero-token/src/zero-token/providers/chatgpt-web-auth.ts
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

export interface ChatGPTWebAuthResult extends AuthResult {
  extra: {
    accessToken: string;
    sessionId: string;
  };
}

export async function loginChatGPTWeb(opts: AuthOptions): Promise<ChatGPTWebAuthResult> {
  let capturedAccessToken = "";

  return runAuthFlow(
    {
      ...opts,
      targetUrl: opts.targetUrl ?? "https://chatgpt.com/",
      cookieDomain: "chatgpt.com",
    },
    {
      checkExisting: async (context, page) => {
        const cookies = await getCookies(context, "chatgpt.com");
        const sessionCookie = cookies.find(
          c => c.name === "__Secure-next-auth.session-token" ||
               c.name === "next-auth.session-token",
        );

        if (sessionCookie) {
          // Try to get access token from page
          try {
            const token = await page.evaluate(() => {
              // ChatGPT stores token in localStorage or session storage
              return localStorage.getItem("accessToken") ||
                     sessionStorage.getItem("accessToken") ||
                     "";
            });
            if (token) capturedAccessToken = token;
          } catch { /* ignore */ }

          log(opts, "Found existing ChatGPT session!");
          return {
            provider: "chatgpt-web",
            cookie: formatCookies(cookies),
            bearer: capturedAccessToken || undefined,
            userAgent: await page.evaluate(() => navigator.userAgent),
            extra: {
              accessToken: capturedAccessToken,
              sessionId: sessionCookie.value.slice(0, 32),
            },
          } as ChatGPTWebAuthResult;
        }
        return null;
      },

      onRequest: async (request) => {
        const url = request.url();
        if (!url.includes("chatgpt.com") && !url.includes("openai.com")) return;

        const headers = request.headers();
        const authHeader = headers["authorization"];
        if (authHeader?.startsWith("Bearer ")) {
          if (!capturedAccessToken) {
            log(opts, "Captured ChatGPT access token.");
            capturedAccessToken = authHeader.slice(7);
          }
        }
      },

      periodicCheck: async (context, page) => {
        if (!capturedAccessToken) {
          try {
            const token = await page.evaluate(() => {
              return localStorage.getItem("accessToken") ||
                     sessionStorage.getItem("accessToken") ||
                     "";
            });
            if (token) capturedAccessToken = token;
          } catch { /* ignore */ }
        }

        if (!capturedAccessToken) return null;

        const cookies = await getCookies(context, "chatgpt.com");
        const sessionCookie = cookies.find(
          c => c.name === "__Secure-next-auth.session-token" ||
               c.name === "next-auth.session-token",
        );

        return {
          provider: "chatgpt-web",
          cookie: formatCookies(cookies),
          bearer: capturedAccessToken,
          userAgent: await page.evaluate(() => navigator.userAgent),
          extra: {
            accessToken: capturedAccessToken,
            sessionId: sessionCookie?.value.slice(0, 32) ?? "",
          },
        } as ChatGPTWebAuthResult;
      },
    },
  ) as Promise<ChatGPTWebAuthResult>;
}
