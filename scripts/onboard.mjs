#!/usr/bin/env node
// llmgw — Auth credential capture wizard (Node.js)
// Connects to Chrome via CDP, extracts cookies/bearer tokens from logged-in sessions
// Cross-platform: Windows / macOS / Linux

import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDP_PORT = process.env.CDP_PORT || 9222;
// Try IPv6 first (some Chrome builds default to ::1), fall back to IPv4
const CDP_HOSTS = ['127.0.0.1', '[::1]', 'localhost'];

// ─── Provider definitions ──────────────────────────────────────
const PROVIDERS = [
  { id: 'deepseek-web',  name: 'DeepSeek',       domain: 'chat.deepseek.com' },
  { id: 'claude-web',    name: 'Claude',          domain: 'claude.ai' },
  { id: 'kimi-web',      name: 'Kimi',            domain: 'kimi.com' },
  { id: 'doubao-web',    name: 'Doubao (豆包)',    domain: 'doubao.com' },
  { id: 'xiaomimo-web',  name: 'Xiaomi MiMo',     domain: 'xiaomimo.ai' },
  { id: 'qwen-web',      name: 'Qwen (国际)',      domain: 'chat.qwen.ai' },
  { id: 'qwen-cn-web',   name: 'Qwen (国内)',      domain: 'chat.qwen.ai' },
  { id: 'glm-web',       name: 'GLM (智谱)',       domain: 'chatglm.cn' },
  { id: 'glm-intl-web',  name: 'GLM (国际)',       domain: 'chat.z.ai' },
  { id: 'perplexity-web', name: 'Perplexity',      domain: 'perplexity.ai' },
  { id: 'chatgpt-web',   name: 'ChatGPT',         domain: 'chatgpt.com' },
  { id: 'gemini-web',    name: 'Gemini',           domain: 'gemini.google.com' },
  { id: 'grok-web',      name: 'Grok',             domain: 'grok.com' },
];

// ─── HTTP helpers ──────────────────────────────────────────────
async function httpGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Try each host until one responds to /json/version */
async function findCdpUrl() {
  for (const host of CDP_HOSTS) {
    const url = `http://${host}:${CDP_PORT}`;
    try {
      await httpGet(`${url}/json/version`);
      return url;
    } catch { /* try next */ }
  }
  return null;
}

async function checkChrome(cdpUrl) {
  try {
    return await httpGet(`${cdpUrl}/json/version`);
  } catch {
    return null;
  }
}

async function getTargets(cdpUrl) {
  return httpGet(`${cdpUrl}/json`);
}

// ─── CDP helpers ───────────────────────────────────────────────
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    let id = 0;
    const pending = new Map();

    ws.on('open', () => {
      const send = (method, params = {}) => {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { res, rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      };
      resolve({ ws, send });
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });

    ws.on('error', reject);
    setTimeout(() => reject(new Error('CDP WebSocket timeout')), 5000);
  });
}

// ─── Cookie extraction ─────────────────────────────────────────
async function getCookies(cdpUrl, domain) {
  const targets = await getTargets(cdpUrl);
  const tab = targets.find(t => t.type === 'page' && t.url?.includes(domain))
    || targets.find(t => t.type === 'page');

  if (!tab?.webSocketDebuggerUrl) return null;

  const { ws, send } = await cdpConnect(tab.webSocketDebuggerUrl);
  try {
    await send('Network.enable');
    const result = await send('Network.getAllCookies');
    const cookies = result.cookies || [];
    const matching = cookies.filter(c => c.domain?.includes(domain));
    const cookieStr = matching
      .filter(c => c.name && c.value)
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
    return cookieStr || null;
  } finally {
    ws.close();
  }
}

// ─── Bearer token extraction ───────────────────────────────────
async function extractBearer(cdpUrl, domain) {
  const targets = await getTargets(cdpUrl);
  const tab = targets.find(t => t.type === 'page' && t.url?.includes(domain))
    || targets.find(t => t.type === 'page');

  if (!tab?.webSocketDebuggerUrl) return null;

  const { ws, send } = await cdpConnect(tab.webSocketDebuggerUrl);
  try {
    const result = await send('Runtime.evaluate', {
      expression: `
        (function() {
          // localStorage
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const val = localStorage.getItem(key);
            if (val && (val.includes('Bearer') || val.includes('bearer') || key.includes('token') || key.includes('auth'))) {
              try {
                const p = JSON.parse(val);
                if (p.accessToken) return p.accessToken;
                if (p.token) return p.token;
                if (p.bearer) return p.bearer;
              } catch(e) {}
            }
          }
          // sessionStorage
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            const val = sessionStorage.getItem(key);
            if (val && (key.includes('token') || key.includes('auth'))) {
              try {
                const p = JSON.parse(val);
                if (p.accessToken) return p.accessToken;
                if (p.token) return p.token;
              } catch(e) {}
            }
          }
          return '';
        })()
      `,
      returnByValue: true,
    });
    return result?.result?.value || null;
  } finally {
    ws.close();
  }
}

// ─── Interactive selection (stdin) ─────────────────────────────
function askSelection() {
  return new Promise((resolve) => {
    const rl = process.stdin;
    process.stdout.write('\nProviders:\n');
    PROVIDERS.forEach((p, i) => {
      process.stdout.write(`  [${String(i + 1).padStart(2)}] ${p.name} (${p.id})\n`);
    });
    process.stdout.write(`  [ 0] ALL\n`);
    process.stdout.write(`\nSelect (comma-separated numbers, or 0 for all): `);

    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes('\n')) {
        rl.removeListener('data', onData);
        const input = buf.trim();
        if (input === '0' || input === '') {
          resolve(PROVIDERS.map(p => p.id));
        } else {
          const indices = input.split(/[,\s]+/).map(Number).filter(n => n >= 1 && n <= PROVIDERS.length);
          resolve(indices.map(i => PROVIDERS[i - 1].id));
        }
      }
    };
    rl.setRawMode?.(false);
    rl.resume();
    rl.on('data', onData);
  });
}

// ─── Config YAML auto-update ───────────────────────────────────
function buildAuthJson(cookie, bearer) {
  const obj = { cookie };
  if (bearer) obj.bearer = bearer;
  return JSON.stringify(obj);
}

async function updateConfig(results) {
  const configPath = resolve(__dirname, '..', 'config.yaml');
  let yaml;
  try {
    yaml = await readFile(configPath, 'utf-8');
  } catch {
    console.log(`\n✗ config.yaml not found at ${configPath}`);
    return false;
  }

  let count = 0;
  const lines = yaml.split('\n');

  for (const r of results) {
    const authJson = buildAuthJson(r.cookie, r.bearer);
    // Find the - id: <provider> line
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === `- id: ${r.id}`) {
        // Update enabled and auth in the next ~5 lines
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          if (/^\s+enabled:/.test(lines[j])) {
            lines[j] = lines[j].replace(/enabled:\s*\w+/, 'enabled: true');
          }
          if (/^\s+auth:/.test(lines[j])) {
            lines[j] = lines[j].replace(/auth:\s*'.*'/, `auth: '${authJson}'`);
          }
        }
        count++;
        break;
      }
    }
  }

  if (count === 0) {
    console.log('\n✗ No matching providers found in config.yaml');
    return false;
  }

  const { writeFile } = await import('node:fs/promises');
  await writeFile(configPath, lines.join('\n'), 'utf-8');
  console.log(`✓ Updated ${count} provider(s) in config.yaml`);
  return true;
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('==========================================');
  console.log('  llmgw — Auth Credential Capture');
  console.log('==========================================\n');

  // Check Chrome — try all possible hosts
  console.log(`Checking Chrome on port ${CDP_PORT}...`);
  const cdpUrl = await findCdpUrl();
  if (!cdpUrl) {
    console.error(`✗ Chrome not reachable on port ${CDP_PORT} (tried ${CDP_HOSTS.join(', ')})`);
    console.error('  Start Chrome debug mode first (start.bat option [2]).');
    process.exit(1);
  }
  const ver = await checkChrome(cdpUrl);
  console.log(`✓ Chrome ${ver?.['Browser'] || 'connected'} at ${cdpUrl}\n`);

  // Select providers
  const selected = await askSelection();
  if (!selected.length) {
    console.log('Nothing selected. Bye.');
    process.exit(0);
  }

  console.log(`\nCapturing auth for ${selected.length} provider(s)...\n`);

  const results = [];

  for (const id of selected) {
    const provider = PROVIDERS.find(p => p.id === id);
    if (!provider) continue;

    process.stdout.write(`── ${provider.name} (${provider.id}) ... `);

    try {
      const cookie = await getCookies(cdpUrl, provider.domain);
      const bearer = await extractBearer(cdpUrl, provider.domain).catch(() => null);

      if (cookie) {
        console.log('✓ captured');
        results.push({ id: provider.id, cookie, bearer, name: provider.name });
      } else {
        console.log('✗ no tab found');
      }
    } catch (err) {
      console.log(`✗ ${err.message}`);
    }
  }

  // Output & auto-update config
  if (results.length === 0) {
    console.log('\nNo credentials captured. Make sure you are logged in to the platforms.');
    process.exit(1);
  }

  console.log('\n==========================================');

  // Auto-write config.yaml
  await updateConfig(results);

  console.log('==========================================');
  console.log('\nRestart gateway (start.bat [7]) to apply.');
}

main().catch(err => {
  console.error(`\n[ERROR] ${err.message}`);
  process.exit(1);
});
