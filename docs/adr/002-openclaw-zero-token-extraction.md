# ADR-002: 从 openclaw-zero-token 提取核心功能完成 llmgw 独立服务

- **日期**: 2026-04-11
- **状态**: 已接受
- **决策者**: 开发团队

## 背景

[openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token) 是 OpenClaw 项目中的零 Token 成本模块，通过浏览器驱动各 LLM 平台 Web UI 实现免费调用。该模块深度耦合 OpenClaw 内部类型（`@mariozechner/pi-agent-core`、`@mariozechner/pi-ai` 等），无法独立使用。

[llmgw](https://github.com/uplusplus/llmgw) 的目标是从 openclaw-zero-token 中提取核心功能，移除 OpenClaw 依赖，构建一个独立的轻量级 OpenAI 兼容网关服务。

## 项目对比分析

### openclaw-zero-token 核心结构

```
src/zero-token/
├── providers/
│   ├── *-web-auth.ts          # 13个平台认证截获模块（~50KB）
│   ├── *-web-client.ts        # REST API 客户端（DeepSeek/Claude/Doubao/XiaomiMiMo）
│   └── *-web-client-browser.ts # DOM 交互客户端（Qwen/GLM/ChatGPT/Gemini/Grok/Perplexity）
├── streams/
│   ├── *-web-stream.ts        # 13个平台流解析器（~100KB），含完整 think 标签解析
│   └── strip-inbound-meta.ts  # 入站元数据剥离
├── tool-calling/
│   ├── web-stream-middleware.ts # 流中间件（输入重写 + 输出解析）
│   ├── web-tool-defs.ts        # 工具定义（6个核心工具）
│   ├── web-tool-parser.ts      # 工具调用提取（fenced JSON / bare JSON / XML）
│   └── web-tool-prompt.ts      # 按模型分类的 prompt 模板（CN/EN/Strict）
└── bridge/
    └── web-providers.ts        # Provider 注册桥接
```

总计约 15,000+ 行核心代码，依赖 OpenClaw 内部类型系统。

### llmgw 当前状态（~75% 完成）

| 模块 | 原版行数 | llmgw 行数 | 状态 |
|------|---------|-----------|------|
| DeepSeek client+stream | 1179 | 377 | ✅ 核心逻辑已移植，流解析已增强 |
| Claude client+stream | 729 | 197 | ⚠️ 基础版可用，流解析待增强 |
| Kimi client+stream | 747 | 239 | ⚠️ 基础版可用，Connect-JSON 协议完整 |
| Tool calling | 482 | ~200 | ⚠️ 简化版，CN/EN/Strict 模板已移植 |
| 14 Provider 总计 | ~15000+ | ~3500 | 每个都有基础实现 |

#### 已完成 ✅
- 项目脚手架（package.json, tsconfig, tsdown）
- HTTP 服务骨架（Hono + OpenAI 兼容端点）
- 配置系统（YAML + Zod 校验）
- Browser 管理（CDP 连接/Chrome 健康检查）
- 14 个 Provider 基础实现
- 基础流解析器（SSE + Connect-JSON）
- Tool calling 中间件基础版
- DeepSeek 流解析增强（think 标签缓冲、JUNK_TOKENS、malformed 标签）
- Chrome 调试模式启动脚本
- Auth 凭据截获向导
- Docker + docker-compose 部署配置

#### 待完成 ❌

**P0 — 核心流解析增强**（影响所有 provider 的响应质量）
- 通用 `TagAwareStreamParser`：think/thinking/thought 多标签支持、JUNK_TOKENS 过滤、malformed 标签处理、递归 flushBuffer
- DeepSeek 特定：data.v 数组 fragments、nested response.fragments、search_result 类型、parent_message_id 追踪
- Claude：content_block_start/delta/stop 事件序列、message_start/message_delta、thinking 分离
- Kimi：op 字段处理（append/set）、thinking 块、完整消息解析
- 其余 10 个平台的流解析增强

**P1 — Auth 自动化模块**（13 个文件）
- deepseek-web-auth.ts（18KB — PoW challenge + session）
- claude-web-auth.ts（6KB — OrgId 自动发现）
- 其余 11 个平台的 auth 模块

**P2 — 功能增强**
- Tool calling 中间件完善（当前基本完整，差异不大）
- 各平台 DOM 交互增强（Qwen/GLM/ChatGPT/Gemini/Grok/Perplexity）

**P3 — 测试与部署**
- 端到端测试（至少验证 3 个 provider）
- 并发 & 会话隔离测试
- Docker 构建验证
- CI 配置

## 决策

采用**渐进式移植**策略：

1. **保留 llmgw 现有架构**：单一 ProviderAdapter 接口、YAML + Zod 配置、Hono HTTP 框架
2. **流解析器统一增强**：创建通用 `TagAwareStreamParser`，各 provider 按需调用
3. **Auth 模块独立**：在 `src/auth/` 目录下创建，使用 Playwright-core CDP，不依赖 OpenClaw
4. **不引入 OpenClaw 依赖**：所有类型自定义，不使用 `@mariozechner/*` 等包

### 关键移植细节

| 组件 | 移植方式 |
|------|---------|
| DeepSeek SHA3 WASM base64 | 完整保留（35,484 字符） |
| DeepSeek PoW 算法 | SHA256 + DeepSeekHashV1 完全一致 |
| Kimi Connect-JSON 帧 | 0x00 + 4-byte BE length + JSON 协议一致 |
| GLM X-Sign 签名 | Nonce/Timestamp 签名算法一致 |
| Tool calling 模板 | CN/EN/Strict 三种模型分类 + 6 种工具定义 |
| 各平台 API 端点 | URL 完全对应 |

### 技术选型确认

- **语言**: TypeScript（严格模式）
- **运行时**: Node.js 22+
- **HTTP 框架**: Hono（轻量，原生 SSE 支持）
- **浏览器自动化**: Playwright-core（CDP 连接）
- **配置**: YAML + Zod 校验
- **构建**: tsdown + tsc
- **测试**: vitest

## 后果

### 正面
- 独立服务，无 OpenClaw 依赖
- OpenAI 完全兼容接口，可直接替代 `api.openai.com`
- 支持 17+ 平台（13 web + API 兼容平台）
- 零 Token 成本（通过浏览器 cookie 认证）

### 风险
- 平台 API 变更需持续维护
- Cookie 有效期 7-30 天，需定期重新登录
- 平台可能检测自动化行为并封禁
- DOM 交互类 provider（Qwen/GLM/Gemini 等）稳定性依赖页面结构

### 缓解措施
- 使用真实浏览器 profile（attach 模式）
- 不高频并发请求
- 保留正常 User-Agent 和 Referer
- 凭证不持久化，运行时内存持有

## 参考

- openclaw-zero-token 源码: `src/zero-token/`
- llmgw TODO: `TODO.md`
- llmgw README: `README.md`
