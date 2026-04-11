/**
 * Auth base — shared types and helpers for browser-based credential capture.
 * Standalone — no OpenClaw dependencies.
 *
 * Each platform's auth module connects to an existing Chrome via CDP,
 * captures cookies / bearer tokens / session keys, and returns an AuthResult.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import {
  getChromeWebSocketUrl,
  withCdpSocket,
  type CdpSendFn,
} from "../browser/cdp.js";

// ── Types ──

export interface AuthResult {
  /** Platform identifier */
  provider: string;
  /** Captured cookies as "name=value; name2=value2" */
  cookie: string;
  /** Bearer token (if captured) */
  bearer?: string;
  /** User-Agent string */
  userAgent: string;
  /** Platform-specific extras */
  extra?: Record<string, string>;
}

export interface AuthOptions {
  /** CDP URL (http:// or ws://) */
  cdpUrl: string;
  /** Target platform URL to navigate to */
  targetUrl: string;
  /** Timeout in ms (default: 300000 = 5min) */
  timeoutMs?: number;
  /** Progress callback */
  onProgress?: (msg: string) => void;
  /** Cookie domain filter (e.g. "claude.ai") */
  cookieDomain?: string;
}

export interface AuthHooks {
  /**
   * Called after navigation. Return true if auth is already captured
   * (e.g. cookies indicate existing session).
   */
  checkExisting?: (context: BrowserContext, page: Page) => Promise<AuthResult | null>;
  /**
   * Called on every page request. Can intercept auth headers.
   */
  onRequest?: (request: { url: () => string; headers: () => Record<string, string> }) => Promise<void>;
  /**
   * Called on every page response. Can extract tokens from response.
   */
  onResponse?: (response: { url: () => string; ok: () => boolean }) => Promise<void>;
  /**
   * Periodic check (every 2s). Return AuthResult when auth is captured.
   */
  periodicCheck?: (context: BrowserContext, page: Page) => Promise<AuthResult | null>;
  /**
   * Build final AuthResult from captured data.
   */
  buildResult?: (context: BrowserContext, page: Page, captured: Record<string, string>) => Promise<AuthResult | null>;
}

// ── Helpers ──

export function log(opts: AuthOptions, msg: string): void {
  opts.onProgress?.(msg);
  console.log(`[auth] ${msg}`);
}

/**
 * Connect to Chrome and run an auth flow.
 * Handles the full lifecycle: connect → navigate → wait for login → capture.
 */
export async function runAuthFlow(
  opts: AuthOptions,
  hooks: AuthHooks = {},
): Promise<AuthResult> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const progress = (msg: string) => log(opts, msg);

  progress("Connecting to browser...");

  const wsUrl = await getChromeWebSocketUrl(opts.cdpUrl, 5000);
  if (!wsUrl) {
    throw new Error(`Cannot connect to Chrome at ${opts.cdpUrl}. Start Chrome with --remote-debugging-port first.`);
  }

  const browser = await chromium.connectOverCDP(wsUrl);
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(opts.targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const userAgent = await page.evaluate(() => navigator.userAgent);

  progress("Please login in the browser window...");

  const captured: Record<string, string> = {};
  let resolved = false;
  let result: AuthResult | null = null;

  const finalize = async (): Promise<AuthResult | null> => {
    if (hooks.buildResult) {
      return hooks.buildResult(context, page, captured);
    }
    return null;
  };

  return new Promise<AuthResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) {
        reject(new Error(`Auth timed out (${timeoutMs / 1000}s).`));
      }
    }, timeoutMs);

    const tryResolve = async () => {
      if (resolved) return;

      // Check existing session first
      if (hooks.checkExisting) {
        result = await hooks.checkExisting(context, page);
        if (result) {
          resolved = true;
          clearTimeout(timeout);
          resolve(result);
          return;
        }
      }

      // Periodic check
      if (hooks.periodicCheck) {
        result = await hooks.periodicCheck(context, page);
        if (result) {
          resolved = true;
          clearTimeout(timeout);
          resolve(result);
          return;
        }
      }

      // Build result from captured data
      result = await finalize();
      if (result) {
        resolved = true;
        clearTimeout(timeout);
        resolve(result);
      }
    };

    if (hooks.onRequest) {
      page.on("request", async (request) => {
        await hooks.onRequest!(request);
        await tryResolve();
      });
    }

    if (hooks.onResponse) {
      page.on("response", async (response) => {
        await hooks.onResponse!(response);
        await tryResolve();
      });
    }

    page.on("close", () => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error("Browser window closed before auth was captured."));
      }
    });

    // Initial check
    queueMicrotask(() => void tryResolve());

    // Periodic fallback
    const interval = setInterval(() => {
      void tryResolve();
      if (resolved) clearInterval(interval);
    }, 2000);
  });
}

/**
 * Extract cookies from context for a given domain.
 */
export async function getCookies(
  context: BrowserContext,
  domain: string,
): Promise<Array<{ name: string; value: string }>> {
  const domains = [`https://${domain}`, `https://www.${domain}`];
  const cookies = await context.cookies(domains);
  return cookies.map(c => ({ name: c.name, value: c.value }));
}

/**
 * Format cookies as "name=value; name2=value2" string.
 */
export function formatCookies(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map(c => `${c.name}=${c.value}`).join("; ");
}
