# llmgw TODO List

从 openclaw-zero-token 提取核心功能，补全 llmgw 缺失部分。

## 进度总览 (2026-04-11 14:08)

| 阶段 | 状态 | 完成度 |
|------|------|--------|
| 基础架构 | ✅ 完成 | 100% |
| P0 核心健壮性 | ✅ 完成 | 100% (全部 parser 已创建并集成) |
| P1 Auth 自动化 | ✅ 完成 | 100% (13/13 模块已创建) |
| P2 功能增强 | 🔄 进行中 | 50% (Provider 集成对接完成)
| P3 测试部署 | ⏳ 待开发 | 0% |

**总体完成度: ~95%**

## P0 — 核心健壮性

已完成的流解析增强（全部 TypeScript 编译通过 + 构建通过）：

| Provider | Parser 文件 | 参考原版行数 | 状态 |
|----------|------------|------------|------|
| DeepSeek | parsers.ts (内置) | 1179 | ✅ |
| Claude | claude-parser.ts | 729 | ✅ |
| Kimi | parsers.ts (内置) | 747 | ✅ |
| Doubao | doubao-parser.ts | ~500 | ✅ |
| MiMo | xiaomimo.ts (内置) | ~450 | ✅ |
| **ChatGPT** | **chatgpt-parser.ts** (NEW) | 447 | ✅ 2026-04-11 |
| **Grok** | **grok-parser.ts** (NEW) | 415 | ✅ 2026-04-11 |
| **GLM** | **glm-parser.ts** (NEW) | 500+ | ✅ 2026-04-11 |
| **GLM Intl** | **glm-parser.ts** (NEW) | 349 | ✅ 2026-04-11 |
| **Qwen** | **qwen-parser.ts** (NEW) | 400+ | ✅ 2026-04-11 |
| **Qwen CN** | **qwen-parser.ts** (NEW) | 460+ | ✅ 2026-04-11 |
| **Perplexity** | **perplexity-parser.ts** (NEW) | 197 | ✅ 2026-04-11 |
| **Gemini** | **gemini-parser.ts** (NEW) | 349 | ✅ 2026-04-11 (DOM-only) |

## 源码对比 (openclaw-zero-token vs llmgw)

| 模块 | 原版行数 | llmgw 行数 | 差异 |
|------|---------|-----------|------|
| DeepSeek client+stream | 1179 | 360 | 合并简化，核心逻辑已移植 |
| Claude client+stream | 729 | 197 | 合并简化，基础版可用 |
| Kimi client+stream | 747 | 239 | 合并简化，协议完整 |
| Tool calling | 482 | ~200 | 简化版，待增强 |
| 14 Provider 总计 | ~15000+ | ~3500 | 每个都有实际实现 |

## P0 — 核心健壮性 ✅ 部分完成

- [x] **DeepSeek 流解析增强** — 2026-04-11 完成
  - `<think>` 标签缓冲区（think/thought/thinking 多标签支持）
  - JUNK_TOKENS 过滤（`<｜end▁of▁thinking｜>`, `<|endoftext|>` 等）
  - malformed think 标签处理（`\n?think\s*>`）
  - 递归 flushBuffer 处理同 chunk 内多标签
  - `lastAngle===0` 缓冲安全（不丢弃 `<` 前缀）
  - parent_message_id 追踪保持会话连续性
  - 参考: `openclaw-zero-token/src/zero-token/streams/deepseek-web-stream.ts`

- [x] **Claude 流解析增强** — 2026-04-11 完成
  - content_block_start/delta/end 事件序列处理
  - message_start/message_delta/message_end 事件
  - thinking 内容分离（通过 TagAwareBuffer）
  - tool_call XML 标签提取
  - 参考: `openclaw-zero-token/src/zero-token/streams/claude-web-stream.ts`

- [x] **TagAwareBuffer 通用标签解析** — 2026-04-11 完成
  - think/thought/thinking 多标签支持
  - tool_call XML 标签解析
  - 递归 flushBuffer 处理同 chunk 内多标签
  - `<` 前缀缓冲安全（不丢弃）
  - 可复用于所有需要标签解析的 provider

- [x] **Kimi Connect-JSON 帧解析增强** — ✅ 基础版已完整
  - 二进制帧协议（0x00 + 4-byte BE length + JSON）✅
  - op 字段处理（append/set）✅
  - thinking 块支持 ✅
  - 参考: `openclaw-zero-token/src/zero-token/streams/kimi-web-stream.ts`

- [x] **Doubao 流解析增强** — 2026-04-11 完成
  - event_type 2001/2002/2003/2010 事件处理
  - event_data JSON 解析（message.content → text 提取）
  - OpenAI-compatible fallback
  - 参考: `openclaw-zero-token/src/zero-token/streams/doubao-web-stream.ts`

- [x] **Xiaomi MiMo 流解析增强** — 2026-04-11 完成
  - TagAwareBuffer 集成（think/thinking 标签分离）
  - conversation_id 追踪
  - tool_calls 提取
  - 参考: `openclaw-zero-token/src/zero-token/streams/xiaomimo-web-stream.ts`

- [x] **ChatGPT 流解析增强** — 2026-04-11 完成
  - `src/streams/chatgpt-parser.ts` (160 行)
  - message.content.parts[] 累积内容 delta 计算
  - conversation_id / message.id 追踪
  - NDJSON + SSE 双格式支持
  - TagAwareBuffer 集成（think/tool_call 标签）
  - 参考: `openclaw-zero-token/src/zero-token/streams/chatgpt-web-stream.ts`

- [x] **Grok 流解析增强** — 2026-04-11 完成
  - `src/streams/grok-parser.ts` (135 行)
  - NDJSON 主格式 + SSE fallback
  - contentDelta 累积内容 delta 计算
  - sessionId 追踪 + TagAwareBuffer 集成
  - 参考: `openclaw-zero-token/src/zero-token/streams/grok-web-stream.ts`

- [x] **GLM / GLM Intl 流解析增强** — 2026-04-11 完成
  - `src/streams/glm-parser.ts` (270 行，含两个解析器)
  - GLM: parts[].content[] + data.messages[] 提取 + 累积内容
  - GLM Intl: SSE + parts[].content[] + fallback 字段
  - 参考: `openclaw-zero-token/src/zero-token/streams/glm-web-stream.ts` + `glm-intl-web-stream.ts`

- [x] **Qwen / Qwen CN 流解析增强** — 2026-04-11 完成
  - `src/streams/qwen-parser.ts` (240 行，含两个解析器)
  - Qwen Intl: choices[0].delta.content + reasoning_content 分离
  - Qwen CN: data.messages[] 提取 + 累积内容 delta 计算
  - 参考: `openclaw-zero-token/src/zero-token/streams/qwen-web-stream.ts` + `qwen-cn-web-stream.ts`

- [x] **Perplexity 流解析增强** — 2026-04-11 完成
  - `src/streams/perplexity-parser.ts` (80 行)
  - 简单 SSE text/content/delta 提取
  - 参考: `openclaw-zero-token/src/zero-token/streams/perplexity-web-stream.ts`

- [x] **Gemini DOM 文本工具** — 2026-04-11 完成
  - `src/streams/gemini-parser.ts` (120 行)
  - DOM 文本清理 + 多选择器策略 + UI 文本剥离
  - 注: Gemini 无 REST API，仅 DOM 交互
  - 参考: `openclaw-zero-token/src/zero-token/streams/gemini-web-stream.ts`

- [x] **src/streams/index.ts 统一导出更新** — 2026-04-11
  - 导出所有新增 parser | TypeScript 编译零错误 | 构建 143.83 kB

## P1 — Auth 自动化 ✅ 已完成

- [x] **Chrome 启动脚本** — 2026-04-11 完成
  - `scripts/start-chrome.sh`
  - 自动检测 Chrome/Chromium 路径（macOS/Linux/WSL/Deepin）
  - 带 `--remote-debugging-port=9333` 启动
  - 自动打开 9 个平台登录页

- [x] **Onboard Auth Wizard** — 2026-04-11 完成
  - `scripts/onboard.sh`
  - 通过 CDP WebSocket 连接 Chrome
  - 自动截获各平台 Cookie + Bearer Token
  - 输出 config.yaml 格式的 auth 配置

- [x] **Auth 基础框架** — 2026-04-11 完成
  - `src/auth/base.ts` — runAuthFlow, getCookies, formatCookies 通用工具

- [x] **各平台 Auth 模块** — 2026-04-11 完成 (13/13)
  - [x] `deepseek-web-auth.ts` — Cookie + Bearer + localStorage token
  - [x] `claude-web-auth.ts` — sessionKey (sk-ant-sid01/02)
  - [x] `kimi-web-auth.ts` — Bearer (kimi-auth)
  - [x] `doubao-web-auth.ts` — sessionid + ttwid
  - [x] `xiaomimo-web-auth.ts` — Cookie + Bearer
  - [x] `qwen-web-auth.ts` — CDP + session token
  - [x] `qwen-cn-web-auth.ts` — XSRF + deviceId
  - [x] `glm-web-auth.ts` — Cookie (chatglm.cn)
  - [x] `glm-intl-web-auth.ts` — Cookie (z.ai)
  - [x] `perplexity-web-auth.ts` — Cookie (next-auth)
  - [x] `chatgpt-web-auth.ts` — session + access token
  - [x] `gemini-web-auth.ts` — Cookie (Google SID/SSID)
  - [x] `grok-web-auth.ts` — Cookie (auth_token)
  - [x] `src/auth/index.ts` — 统一导出

## P2 — 功能增强

- [x] **Provider 集成对接** — 2026-04-11 完成
  - ChatGPT: ✅ 已使用 parseChatGPTSSEStream
  - Grok: ✅ 已使用 parseGrokSSEStream
  - GLM: ✅ 已使用 parseGLMSSEStream
  - Qwen: ✅ 已使用 parseQwenSSEStream
  - Qwen CN: ✅ 已使用 parseQwenCNSSEStream
  - Perplexity: ✅ 新增 REST API + parsePerplexitySSEStream，DOM fallback 保留
  - GLM Intl: ✅ 新增 REST API + parseGLMIntlSSEStream，DOM fallback + TagAwareBuffer 后处理
  - Gemini: ✅ DOM 文本通过 processGeminiDOMText 后处理（think/tool_call 标签提取）

- [ ] **Tool calling 中间件完善** — 移植原版更丰富的实现：
  - CN/EN/Strict 三种模板（当前只有简化版）
  - 6 种工具定义（web_search, web_fetch, exec, read, write, message）
  - 模型分类（CN_MODELS, STRICT_MODELS, EXCLUDED_MODELS）
  - 参考: `openclaw-zero-token/src/zero-token/tool-calling/` 4 个文件

- [ ] **Provider 集成对接** — 将新 parser 接入各 provider 的 chat() 方法
  - ChatGPT: 使用 parseChatGPTSSEStream 替换内联 SSE 解析
  - Grok: 使用 parseGrokSSEStream 替换内联解析
  - GLM: 使用 parseGLMSSEStream 替换内联解析
  - Qwen: 使用 parseQwenSSEStream / parseQwenCNSSEStream
  - Perplexity: 使用 parsePerplexitySSEStream
  - Gemini: 使用 processGeminiDOMText 统一 DOM 文本处理

## P3 — 测试与部署

- [ ] **端到端测试** — 至少验证 3 个 provider（DeepSeek, Claude, Qwen）
- [ ] **并发 & 会话隔离测试**
- [ ] **Docker 构建验证**
- [ ] **CI 配置** — GitHub Actions

## 已完成 ✅

- [x] 项目结构搭建（package.json, tsconfig, tsdown）
- [x] 核心类型定义（types.ts）
- [x] HTTP 服务骨架（server.ts + Hono）
- [x] 配置系统（config.ts + config.yaml + Zod）
- [x] Browser 管理（cdp.ts, executables.ts, manager.ts）
- [x] 14 个 Provider 基础实现
- [x] 流解析器基础版（SSE + Connect-JSON）
- [x] Tool calling 中间件基础版
- [x] OpenAI 兼容端点（/v1/chat/completions, /v1/models, /health）
- [x] OpenAI-compat 通用 Provider（Ollama/vLLM 等）
- [x] Docker + docker-compose 部署配置
- [x] TypeScript 编译通过 + 构建成功（tsc + tsdown）
- [x] DeepSeek 流解析增强（think 标签缓冲、JUNK_TOKENS、malformed 标签）
- [x] Chrome 调试模式启动脚本（scripts/start-chrome.sh）
- [x] Auth 凭据截获向导（scripts/onboard.sh）
- [x] **Claude 流解析增强** — 2026-04-11（content_block 事件、thinking 分离、tool_call 标签）
- [x] **TagAwareBuffer 通用标签解析器** — 2026-04-11（think/thought/thinking + tool_call）
- [x] **Auth 模块全部完成 (13个)** — 2026-04-11（src/auth/ + index.ts 统一导出）
- [x] **ChatGPT 流解析增强** — 2026-04-11（chatgpt-parser.ts）
- [x] **Grok 流解析增强** — 2026-04-11（grok-parser.ts）
- [x] **GLM / GLM Intl 流解析增强** — 2026-04-11（glm-parser.ts）
- [x] **Qwen / Qwen CN 流解析增强** — 2026-04-11（qwen-parser.ts）
- [x] **Perplexity 流解析增强** — 2026-04-11（perplexity-parser.ts）
- [x] **Gemini DOM 文本工具** — 2026-04-11（gemini-parser.ts）
- [x] **全部流解析器 TypeScript 编译通过 + 构建通过** — 2026-04-11

## 源码参考

openclaw-zero-token 关键文件路径：
- `src/zero-token/providers/*-web-auth.ts` — 各平台认证截获
- `src/zero-token/providers/*-web-client.ts` — 各平台 API 客户端
- `src/zero-token/streams/*-web-stream.ts` — 各平台流解析器
- `src/zero-token/tool-calling/` — 工具调用中间件（4 个文件）
