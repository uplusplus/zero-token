# llmgw

从 [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token) 提取核心功能，独立为轻量服务，提供 OpenAI 兼容接口。

**零 Token 成本** — 通过浏览器驱动各 LLM 平台 Web UI，无需 API Key。

---

## 支持的平台

| 平台 | 状态 | 认证方式 | 协议 | 模型示例 |
|---|---|---|---|---|
| DeepSeek | ✅ 已实现 | Cookie + Bearer + PoW | REST SSE | deepseek-chat, deepseek-reasoner |
| Claude Web | ✅ 已实现 | Cookie + OrgId | REST SSE | claude-sonnet-4-6, claude-opus-4-6 |
| Kimi | ✅ 已实现 | Bearer (kimi-auth) | Connect-JSON 二进制帧 | moonshot-v1-32k |
| Doubao | ✅ 已实现 | sessionid + ttwid | REST SSE | doubao-seed-1-8, doubao-seed-code |
| Xiaomi MiMo | ✅ 已实现 | Cookie + Bearer | REST SSE | xiaomimo-chat, mimo-v2-pro |
| Qwen (国际) | ✅ 已实现 | Cookie + Playwright CDP | page.evaluate fetch | qwen3.5-plus, qwen3.5-turbo |
| Qwen (国内) | ✅ 已实现 | Cookie + XSRF + Playwright | page.evaluate fetch | Qwen3.5-Plus, Qwen3.5-Turbo |
| GLM (智谱) | ✅ 已实现 | Cookie + X-Sign + Playwright | page.evaluate fetch | glm-4-plus, glm-4-think |
| GLM (国际) | ✅ 已实现 | Cookie + Playwright CDP | DOM 交互 | glm-4-plus (Intl) |
| Perplexity | ✅ 已实现 | Cookie + Playwright CDP | DOM 交互 | perplexity-web, perplexity-pro |
| ChatGPT Web | ✅ 已实现 | Cookie + Session + Playwright | API + DOM fallback | gpt-4, gpt-4o, o1 |
| Gemini Web | ✅ 已实现 | Cookie + Playwright CDP | DOM 交互 | gemini-pro, gemini-ultra |
| Grok Web | ✅ 已实现 | Cookie + Playwright CDP | API + DOM fallback | grok-1, grok-2, grok-3 |
| Ollama | ✅ 已实现 | 本地 API | OpenAI-compat | llama3, qwen2.5, mistral |
| OpenRouter | ✅ 已实现 | API Key | OpenAI-compat | auto, hunter-alpha |
| Manus | ✅ 已实现 | API Key | OpenAI-compat | manus-1.6, manus-1.6-lite |
| vLLM/Together/... | ✅ 已实现 | API Key | OpenAI-compat | 各模型 |

---

## 项目结构

```
llmgw/
├── src/
│   ├── server.ts                  # HTTP 服务入口 (Hono)
│   ├── config.ts                  # YAML 配置加载 (Zod 校验)
│   ├── types.ts                   # 核心类型 (Provider, Model, ChatMessage, StreamCallbacks)
│   ├── browser/
│   │   ├── cdp.ts                 # CDP 连接 / WebSocket / Chrome 健康检查
│   │   ├── executables.ts         # 跨平台 Chrome/Chromium 自动检测
│   │   ├── manager.ts             # BrowserManager (launch/attach/close/ensure)
│   │   └── index.ts
│   ├── providers/
│   │   ├── base.ts                # 公共工具 (extractText, buildPrompt, readSSEStream)
│   │   ├── deepseek.ts            # DeepSeek Web (PoW + SHA3 WASM)
│   │   ├── claude.ts              # Claude Web (Cookie + OrgId)
│   │   ├── kimi.ts                # Kimi (Connect-JSON 二进制帧)
│   │   ├── doubao.ts              # Doubao (sessionid + ttwid)
│   │   ├── xiaomimo.ts            # Xiaomi MiMo (Cookie + Bearer REST)
│   │   ├── qwen.ts                # Qwen 国际版 (Playwright page.evaluate)
│   │   ├── qwen-cn.ts             # Qwen 国内版 (XSRF + Playwright)
│   │   ├── glm.ts                 # GLM 智谱 (X-Sign + Playwright)
│   │   ├── glm-intl.ts            # GLM 国际版 (DOM 交互)
│   │   ├── perplexity.ts          # Perplexity (DOM 交互)
│   │   ├── chatgpt.ts             # ChatGPT Web (Sentinel + DOM fallback)
│   │   ├── gemini.ts              # Gemini Web (DOM 交互)
│   │   ├── grok.ts                # Grok Web (API + DOM fallback)
│   │   ├── openai-compat.ts       # OpenAI 兼容通用 provider
│   │   └── index.ts
│   ├── streams/
│   │   ├── parsers.ts             # SSE / Connect-JSON 流解析器
│   │   └── index.ts
│   ├── tool-calling/
│   │   ├── middleware.ts           # Prompt 注入式工具调用中间件
│   │   └── index.ts
│   ├── openai/
│   │   ├── chat-completions.ts    # POST /v1/chat/completions
│   │   ├── models.ts              # GET /v1/models
│   │   ├── health.ts              # GET /health
│   │   └── index.ts
│   └── bridge/
│       └── catalog.ts             # 模型目录 & provider 工厂
├── config.yaml                    # 运行时配置
├── package.json
├── tsconfig.json
└── README.md
```

---

## 技术选型

- **语言**: TypeScript
- **HTTP 框架**: Hono（轻量，原生 SSE 支持）
- **浏览器自动化**: Playwright-core（CDP 连接已有 Chrome 实例）
- **配置**: YAML + Zod 校验
- **包管理**: npm
- **运行时**: Node.js 22+

---

## API 接口

与 OpenAI API 完全兼容，可直接替代 `https://api.openai.com`：

### POST /v1/chat/completions

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### GET /v1/models

```bash
curl http://localhost:8080/v1/models
```

### GET /health

```bash
curl http://localhost:8080/health
```

---

## 认证机制分析

各平台通过 CDP（Chrome DevTools Protocol）从浏览器中截获登录凭证，不破解密码，不绕过登录——
而是让浏览器保持登录状态，我们截获它产生的认证信息。

### 通用流程

```
BrowserManager 启动/连接 Chrome → CDP WebSocket URL
                │
                ▼
  Playwright chromium.connectOverCDP(wsUrl)
                │
                ▼
  截获认证信息（Cookie / Bearer / Token）
                │
                ▼
  返回 { cookie, bearer, userAgent }
```

### 认证方式对比

| 平台 | 认证手段 | PoW 需求 | 交互方式 |
|---|---|---|---|
| DeepSeek | Cookie + Bearer | ✅ SHA256/DeepSeekHashV1 | REST API |
| Claude | Cookie + OrgId | ❌ | REST API |
| Kimi | Bearer (kimi-auth) | ❌ | Connect-JSON |
| Doubao | sessionid + ttwid | ❌ | REST API |
| MiMo | Cookie + Bearer | ❌ | REST API |
| Qwen | Cookie + CDP | ❌ | page.evaluate fetch |
| GLM | Cookie + X-Sign | ❌ | page.evaluate fetch |
| ChatGPT | Cookie + Session | ❌ | API + DOM fallback |
| Gemini | Cookie | ❌ | DOM 交互 |
| Grok | Cookie | ❌ | API + DOM fallback |
| Perplexity | Cookie | ❌ | DOM 交互 |

### 安全考虑

1. **凭证不持久化** — 运行时内存持有，进程退出即销毁
2. **Cookie 过期** — 平台 Cookie 有效期通常 7-30 天，需重新登录
3. **Bypass 风险** — 平台可能检测自动化行为并封禁，建议：
   - 使用真实浏览器 profile（attach 模式）
   - 不要高频并发请求
   - 保留正常 User-Agent 和 Referer

---

## 开发进度

> 详细 TODO 见 [TODO.md](./TODO.md)。总体完成度约 **75%**。

### 进度总览 (2026-04-11)

| 阶段 | 状态 | 完成度 |
|------|------|--------|
| 基础架构 (脚手架/Browser/HTTP/配置) | ✅ 完成 | 100% |
| Provider 基础实现 (14 个) | ✅ 完成 | 100% |
| P0 流解析增强 | 🔄 进行中 | 40% (仅 DeepSeek ✅) |
| P1 Auth 自动化 | 🔄 进行中 | 30% (脚本 ✅, Auth 模块待开发) |
| P2 功能增强 | ⏳ 待开发 | 0% |
| P3 测试部署 | ⏳ 待开发 | 0% |

### 已完成 ✅

- [x] 项目脚手架：`package.json` + `tsconfig.json` + `tsdown`
- [x] 配置系统：`config.yaml`（YAML + Zod 校验）
- [x] 核心类型：`ProviderAdapter`, `ModelDefinition`, `ChatMessage`, `StreamCallbacks`
- [x] HTTP 服务：Hono + OpenAI 兼容端点（`/v1/chat/completions`, `/v1/models`, `/health`）
- [x] 浏览器管理：CDP 连接 / Chrome 健康检查 / headless|launch|attach 三种模式
- [x] 14 个 Provider 基础实现（每个都有实际可用代码）
- [x] 基础流解析器：SSE + Connect-JSON（通用版，不含平台特定标签解析）
- [x] Tool calling 中间件：CN/EN/Strict 三种模板 + 6 种工具定义
- [x] OpenAI-compat 通用 Provider（Ollama/vLLM/OpenRouter/Together/Manus 等）
- [x] DeepSeek 流解析增强：`<think>` 标签缓冲、JUNK_TOKENS 过滤、malformed 标签处理
- [x] Chrome 调试启动脚本 `scripts/start-chrome.sh`
- [x] Auth 凭据截获向导 `scripts/onboard.sh`
- [x] Dockerfile + docker-compose

### 待开发 ❌

#### P0 — 流解析增强（影响响应质量）

只有 DeepSeek 完成了完整移植，其余 provider 使用通用 SSE 解析器，缺少：

- [ ] **通用 `TagAwareStreamParser`** — think/thought/thinking 多标签、JUNK_TOKENS、malformed 标签、递归 flushBuffer
- [ ] **Claude** — content_block_start/delta/stop 事件序列、message_start/message_delta、thinking 分离（原版 507 行）
- [ ] **Kimi** — op 字段处理（append/set）、thinking 块、完整消息解析
- [ ] **Doubao** — 完整流解析（原版 19KB）
- [ ] **ChatGPT** — Sentinel token 处理（原版 15KB）
- [ ] **Gemini** — 多选择器 DOM 解析（原版 13KB）
- [ ] **Grok** — REST API + DOM fallback（原版 15KB）
- [ ] **GLM / GLM Intl** — X-Sign 签名 + DOM 交互（原版 19KB + 16KB）
- [ ] **Qwen / Qwen CN** — page.evaluate fetch 解析（原版 14KB + 16KB）
- [ ] **Perplexity** — DOM 交互（原版 7KB）
- [ ] **Xiaomi MiMo** — REST SSE 解析（原版 16KB）

#### P1 — Auth 自动化模块

`src/auth/` 目录待创建，共 13 个文件：

- [ ] `deepseek-web-auth.ts`（18KB — PoW challenge + session）
- [ ] `claude-web-auth.ts`（6KB — OrgId 自动发现）
- [ ] `kimi-web-auth.ts`（4KB — kimi-auth token 提取）
- [ ] `doubao-web-auth.ts`（6KB — sessionid + ttwid）
- [ ] `xiaomimo-web-auth.ts`（9KB — Cookie + Bearer）
- [ ] `qwen-web-auth.ts`（6KB — CDP + session token）
- [ ] `qwen-cn-web-auth.ts`（7KB — XSRF + deviceId）
- [ ] `glm-web-auth.ts`（3KB）
- [ ] `glm-intl-web-auth.ts`（5KB）
- [ ] `perplexity-web-auth.ts`（4KB）
- [ ] `chatgpt-web-auth.ts`（6KB — session + sentinel）
- [ ] `gemini-web-auth.ts`（3KB）
- [ ] `grok-web-auth.ts`（3KB）

#### P3 — 测试与部署

- [ ] 端到端测试（至少验证 DeepSeek, Claude, Qwen）
- [ ] 并发 & 会话隔离测试
- [ ] Docker 构建验证
- [ ] CI 配置（GitHub Actions）

### 源码对比

| 模块 | 原版行数 | llmgw 行数 | 说明 |
|------|---------|-----------|------|
| DeepSeek client+stream | 1179 | 377 | 核心逻辑已移植，流解析已增强 |
| Claude client+stream | 729 | 197 | 基础版可用，流解析待增强 |
| Kimi client+stream | 747 | 239 | 基础版可用，Connect-JSON 协议完整 |
| Tool calling | 482 | ~200 | CN/EN/Strict 模板已移植 |
| 14 Provider 总计 | ~15000+ | ~3500 | 每个都有基础实现 |

---

## 从 openclaw-zero-token 迁移说明

### 架构变更

| openclaw-zero-token | llmgw | 说明 |
|---|---|---|
| 每个 provider 分 auth + client-browser 两个文件 | 合并为单个 ProviderAdapter 类 | 简化文件结构 |
| 依赖 `launchOpenClawChrome` / `resolveBrowserConfig` | 使用独立 BrowserManager + CDP helpers | 移除 OpenClaw 依赖 |
| 依赖 `loadConfig` (OpenClaw config) | 使用 YAML + Zod 配置 | 独立配置系统 |
| Playwright auth + client 通过 BrowserManager 桥接 | Playwright CDP 连接 + page.evaluate | 统一浏览器访问模式 |

### 已验证一致的关键细节

- ✅ DeepSeek SHA3 WASM base64 (35,484 字符) 完整移植
- ✅ DeepSeek PoW 算法 (SHA256 + DeepSeekHashV1) 完全一致
- ✅ Kimi Connect-JSON 二进制帧协议 (0x00 + 4-byte BE length + JSON)
- ✅ GLM X-Sign/Nonce/Timestamp 签名算法一致
- ✅ 各平台 API 端点 URL 完全对应
- ✅ tool-calling middleware 覆盖所有 CN/EN/Strict 模型分类

---

## License

MIT
