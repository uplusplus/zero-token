# ADR-001: Tool Calling 职责分层

- **日期**: 2026-04-11
- **状态**: 已接受
- **决策者**: 项目讨论

## 背景

llmgw 作为 OpenAI 兼容网关，连接 Agent（使用 OpenAI 协议）和 Web LLM（使用自然语言）。Web LLM 不原生支持 tool calling，需要通过 prompt 注入和文本解析来模拟。这导致工具调用的职责归属需要明确界定。

## 问题

Agent 通过 OpenAI 协议连接 llmgw 时，tool calling 的完整生命周期涉及多个环节。哪些属于网关职责，哪些属于 Agent 职责？

## 调用链路分析

```
Agent ──(OpenAI 协议)──> llmgw ──(自然语言)──> Web LLM
```

### 完整的 tool calling 循环

```
1. Agent 发送 messages + tools 定义
      ↓
2. llmgw: injectToolPrompt — 把 OpenAI tools[] 转成自然语言 prompt 注入到消息中
      ↓
3. Web LLM 返回包含 tool_json 的文本
      ↓
4. llmgw: extractToolCalls — 从文本解析出 ToolCall 结构
      ↓
5. llmgw: 以 OpenAI delta.tool_calls 格式 SSE 发给 Agent
      ↓
6. Agent 执行 tool，拿到结果
      ↓
7. Agent 发回 role:"tool" 消息
      ↓
8. llmgw: formatToolResult — 把 role:"tool" 转成自然语言
      ↓
9. Web LLM 看到 tool 结果，继续生成回答
```

### Agent 视角（与 OpenAI 原生 API 一致）

```json
// 请求
{
  "model": "deepseek-chat",
  "messages": [...],
  "tools": [{"type":"function","function":{"name":"exec","parameters":{...}}}]
}

// 响应（SSE stream）
{"choices":[{"delta":{"tool_calls":[{
  "id":"web_tool_xxx",
  "type":"function",
  "function":{"name":"exec","arguments":"{\"command\":\"ls\"}"}
}]}}]}

// Agent 执行后追加
{
  "messages": [
    ...,
    {"role":"assistant","tool_calls":[...]},
    {"role":"tool","tool_call_id":"web_tool_xxx","content":"README.md\nsrc\n..."}
  ]
}
```

Agent 看到的**与直接调用 OpenAI API 完全一致**。

### 关键区别

| | OpenAI 原生 | llmgw 翻译后 |
|---|---|---|
| 返回形式 | `tool_calls` in delta | `tool_calls` in delta（相同） |
| LLM 知道自己在调 tool | ✅ 原生支持 | ❌ 只是在写文本 |
| `role:"tool"` 消息 | ✅ LLM 原生理解 | ❌ Web LLM 不认识 |

## 决策

职责分层如下：

| 环节 | 职责归属 | 说明 |
|---|---|---|
| tools 定义 | Agent | Agent 决定提供哪些工具 |
| injectToolPrompt | **llmgw** | 协议翻译：OpenAI tools → 自然语言注入 |
| extractToolCalls | **llmgw** | 流解析：LLM 文本 → 结构化 ToolCall |
| 格式化 SSE 响应 | **llmgw** | 协议翻译：ToolCall → OpenAI delta.tool_calls |
| 执行 tool | Agent | Agent 调用实际工具 |
| formatToolResult | **llmgw** | 协议翻译：role:"tool" → 自然语言（Web LLM 不认识 role:"tool"） |
| 追加 tool result 到 messages | Agent | Agent 按 OpenAI 协议追加 |

### 核心原则

**llmgw 的所有 tool calling 相关操作都是协议翻译，不涉及 tool 执行。**

- `injectToolPrompt`: OpenAI 协议 → Web LLM 协议（写入侧翻译）
- `extractToolCalls`: Web LLM 协议 → OpenAI 协议（读取侧翻译）
- `formatToolResult`: OpenAI 协议 → Web LLM 协议（写入侧翻译）

`formatToolResult` 属于网关职责而非 Agent 职责，因为 Web LLM 不理解 `role:"tool"` 消息格式，网关必须将 Agent 发回的 tool result 转换为 Web LLM 能理解的自然语言文本。

## 后果

- llmgw 保持对 Agent 完全透明的 OpenAI 协议兼容
- Agent 无需关心底层是原生 OpenAI 还是 Web LLM 翻译
- tool calling 的完整循环由 llmgw 和 Agent 协作完成，职责边界清晰
