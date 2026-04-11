# llmgw TODO List

从 openclaw-zero-token 提取核心功能，补全 llmgw 缺失部分。

## 进度总览 (2026-04-11)

| 阶段 | 状态 | 完成度 |
|------|------|--------|
| 基础架构 | ✅ 完成 | 100% |
| P0 核心健壮性 | 🔄 进行中 | 40% (DeepSeek ✅, Claude/Kimi 基础可用) |
| P1 Auth 自动化 | 🔄 进行中 | 30% (脚本 ✅, Auth 模块待开发) |
| P2 功能增强 | ⏳ 待开发 | 0% |
| P3 测试部署 | ⏳ 待开发 | 0% |

**总体完成度: ~75%** (含基础架构 85% + 已完成的增强)

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

- [ ] **Claude 流解析增强** — 移植原版 507 行流解析：
  - content_block_delta 类型处理 ✅ 已有基础版
  - thinking 内容分离 ✅ 已有基础版
  - message_start/message_delta 事件处理（待增强）
  - 参考: `openclaw-zero-token/src/zero-token/streams/claude-web-stream.ts`

- [ ] **Kimi Connect-JSON 帧解析增强** — ✅ 基础版已完整
  - 二进制帧协议（0x00 + 4-byte BE length + JSON）✅
  - op 字段处理（append/set）✅
  - thinking 块支持 ✅
  - 参考: `openclaw-zero-token/src/zero-token/streams/kimi-web-stream.ts`

## P1 — Auth 自动化 ✅ 部分完成

- [x] **Chrome 启动脚本** — 2026-04-11 完成
  - `scripts/start-chrome.sh`
  - 自动检测 Chrome/Chromium 路径（macOS/Linux/WSL/Deepin）
  - 带 `--remote-debugging-port=9222` 启动
  - 自动打开 9 个平台登录页

- [x] **Onboard Auth Wizard** — 2026-04-11 完成
  - `scripts/onboard.sh`
  - 通过 CDP WebSocket 连接 Chrome
  - 自动截获各平台 Cookie + Bearer Token
  - 输出 config.yaml 格式的 auth 配置

- [ ] **各平台 Auth 模块移植** — 待开发（需要 playwright-core 深度集成）
  - [ ] deepseek-web-auth.ts（18KB — PoW challenge + session）
  - [ ] claude-web-auth.ts（6KB — OrgId 自动发现）
  - [ ] kimi-web-auth.ts（4KB — kimi-auth token 提取）
  - [ ] doubao-web-auth.ts（6KB — sessionid + ttwid）
  - [ ] xiaomimo-web-auth.ts（9KB — Cookie + Bearer）
  - [ ] qwen-web-auth.ts（6KB — CDP + session token）
  - [ ] qwen-cn-web-auth.ts（7KB — XSRF + deviceId）
  - [ ] glm-web-auth.ts（3KB — Cookie）
  - [ ] glm-intl-web-auth.ts（5KB — Cookie）
  - [ ] perplexity-web-auth.ts（4KB — Cookie）
  - [ ] chatgpt-web-auth.ts（6KB — session + sentinel）
  - [ ] gemini-web-auth.ts（3KB — Cookie）
  - [ ] grok-web-auth.ts（3KB — Cookie）

## P2 — 功能增强

- [ ] **Tool calling 中间件完善** — 移植原版更丰富的实现：
  - CN/EN/Strict 三种模板（当前只有简化版）
  - 6 种工具定义（web_search, web_fetch, exec, read, write, message）
  - 模型分类（CN_MODELS, STRICT_MODELS, EXCLUDED_MODELS）
  - 参考: `openclaw-zero-token/src/zero-token/tool-calling/` 4 个文件

- [ ] **Doubao 流解析增强** — 移植原版 19KB 流解析器
  - 参考: `openclaw-zero-token/src/zero-token/streams/doubao-web-stream.ts`

- [ ] **ChatGPT 流解析增强** — 移植原版 15KB 流解析器
  - Sentinel token 处理
  - 参考: `openclaw-zero-token/src/zero-token/streams/chatgpt-web-stream.ts`

- [ ] **Gemini 流解析增强** — 移植原版 13KB 流解析器
  - 参考: `openclaw-zero-token/src/zero-token/streams/gemini-web-stream.ts`

- [ ] **Grok 流解析增强** — 移植原版 15KB 流解析器
  - 参考: `openclaw-zero-token/src/zero-token/streams/grok-web-stream.ts`

- [ ] **GLM 流解析增强** — 移植原版 19KB (intl: 16KB)
  - 参考: `openclaw-zero-token/src/zero-token/streams/glm-web-stream.ts`

- [ ] **Qwen 流解析增强** — 移植原版 14KB (cn: 16KB)
  - 参考: `openclaw-zero-token/src/zero-token/streams/qwen-web-stream.ts`

- [ ] **Perplexity 流解析增强** — 移植原版 7KB
  - 参考: `openclaw-zero-token/src/zero-token/streams/perplexity-web-stream.ts`

- [ ] **Xiaomi MiMo 流解析增强** — 移植原版 16KB
  - 参考: `openclaw-zero-token/src/zero-token/streams/xiaomimo-web-stream.ts`

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

## 源码参考

openclaw-zero-token 关键文件路径：
- `src/zero-token/providers/*-web-auth.ts` — 各平台认证截获
- `src/zero-token/providers/*-web-client.ts` — 各平台 API 客户端
- `src/zero-token/streams/*-web-stream.ts` — 各平台流解析器
- `src/zero-token/tool-calling/` — 工具调用中间件（4 个文件）
