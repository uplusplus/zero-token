/**
 * Claude Web Stream Parser — enhanced SSE parser with rich event handling.
 *
 * Handles Claude's specific SSE format:
 * - message_start / message_delta / message_end
 * - content_block_start / content_block_delta / content_block_end
 * - thinking content separation
 * - Tool call XML tag extraction
 *
 * Ported from openclaw-zero-token/src/zero-token/streams/claude-web-stream.ts (507 lines)
 */

import type { StreamChunk } from "./parsers.js";

// ── Claude SSE Event Types ──

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
}

interface ClaudeDelta {
  text?: string;
  thinking?: string;
  partial_json?: string;
  stop_reason?: string;
}

interface ClaudeSSEEvent {
  type: string;
  index?: number;
  content_block?: ClaudeContentBlock;
  delta?: ClaudeDelta;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  // Generic fallback fields
  sessionId?: string;
  text?: string;
  content?: string;
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
}

// ── Tag-Aware Buffer ──

export interface TagAwareBuffer {
  /** Current parsing mode */
  mode: "text" | "thinking" | "tool_call";
  /** Tag name for thinking (think/thought/thinking) */
  thinkingTag: string | null;
  /** Tool call name being accumulated */
  toolCallName: string;
  /** Internal buffer */
  _buffer: string;
  /** Push a delta string, yielding normalized chunks */
  push(delta: string): Generator<StreamChunk>;
  /** Flush remaining buffer */
  flush(): Generator<StreamChunk>;
  /** Reset state */
  reset(): void;
}

/**
 * Create a tag-aware buffer that detects think/thought/thinking and tool_call tags
 * in streamed text, separating them into appropriate chunk types.
 */
export function createTagAwareBuffer(opts?: {
  thinkingTags?: string[];
  toolCallTag?: RegExp;
}): TagAwareBuffer {
  const thinkingTagPatterns = (opts?.thinkingTags ?? ["think", "thought", "thinking"]).map(
    (t) => ({
      start: new RegExp(`<${t}\\b[^<>]*>`, "i"),
      end: new RegExp(`</${t}\\b[^<>]*>`, "i"),
      name: t,
    }),
  );

  const toolCallStartRe =
    opts?.toolCallTag ??
    /<tool_call\s*(?:id=['"]?([^'"]+)['"]?\s*)?name=['"]?([^'"]+)['"]?\s*>/i;
  const toolCallEndRe = /<\/tool_call\s*>/i;

  let mode: "text" | "thinking" | "tool_call" = "text";
  let thinkingTag: string | null = null;
  let toolCallName = "";
  let _buffer = "";

  function emitDelta(type: "text" | "thinking" | "tool_call", delta: string): StreamChunk | null {
    if (!delta && type !== "tool_call") return null;
    return { type, content: delta };
  }

  function* processBuffer(): Generator<StreamChunk> {
    // Find all tag matches
    const matches: Array<{
      type: string;
      idx: number;
      len: number;
      name?: string;
      id?: string;
      toolName?: string;
    }> = [];

    // Check thinking tags
    for (const tp of thinkingTagPatterns) {
      const startMatch = _buffer.match(tp.start);
      if (startMatch?.index !== undefined) {
        matches.push({ type: `${tp.name}_start`, idx: startMatch.index, len: startMatch[0].length, name: tp.name });
      }
      const endMatch = _buffer.match(tp.end);
      if (endMatch?.index !== undefined) {
        matches.push({ type: `${tp.name}_end`, idx: endMatch.index, len: endMatch[0].length, name: tp.name });
      }
    }

    // Check tool_call tags
    const toolStartMatch = _buffer.match(toolCallStartRe);
    if (toolStartMatch?.index !== undefined) {
      matches.push({
        type: "tool_start",
        idx: toolStartMatch.index,
        len: toolStartMatch[0].length,
        id: toolStartMatch[1],
        toolName: toolStartMatch[2],
      });
    }
    const toolEndMatch = _buffer.match(toolCallEndRe);
    if (toolEndMatch?.index !== undefined) {
      matches.push({ type: "tool_end", idx: toolEndMatch.index, len: toolEndMatch[0].length });
    }

    // Sort by position
    matches.sort((a, b) => a.idx - b.idx);

    if (matches.length > 0) {
      const first = matches[0];

      // Emit content before the tag
      const before = _buffer.slice(0, first.idx);
      if (before) {
        const chunk = emitDelta(mode, before);
        if (chunk) yield chunk;
      }

      // Handle tag transition
      if (first.type.endsWith("_start")) {
        mode = "thinking";
        thinkingTag = first.name ?? null;
      } else if (first.type.endsWith("_end")) {
        mode = "text";
        thinkingTag = null;
      } else if (first.type === "tool_start") {
        mode = "tool_call";
        toolCallName = first.toolName ?? "";
        if (first.id) {
          yield {
            type: "tool_call",
            toolCall: { id: first.id, name: toolCallName, arguments: "" },
          };
        }
      } else if (first.type === "tool_end") {
        // Tool call ended - try to parse accumulated arguments
        mode = "text";
        toolCallName = "";
      }

      _buffer = _buffer.slice(first.idx + first.len);
      // Recursively process remaining buffer
      yield* processBuffer();
    } else {
      // No tags found — check for partial tag at end
      const lastAngle = _buffer.lastIndexOf("<");
      if (lastAngle === -1) {
        // No possible tag start, emit everything
        const chunk = emitDelta(mode, _buffer);
        if (chunk) yield chunk;
        _buffer = "";
      } else if (lastAngle > 0) {
        // Emit safe content before potential tag
        const safe = _buffer.slice(0, lastAngle);
        const chunk = emitDelta(mode, safe);
        if (chunk) yield chunk;
        _buffer = _buffer.slice(lastAngle);
      }
      // else lastAngle === 0: buffer starts with potential tag, keep buffering
    }
  }

  return {
    get mode() { return mode; },
    get thinkingTag() { return thinkingTag; },
    get toolCallName() { return toolCallName; },
    get _buffer() { return _buffer; },

    push(delta: string): Generator<StreamChunk> {
      _buffer += delta;
      return processBuffer();
    },

    *flush(): Generator<StreamChunk> {
      if (!_buffer) return;
      const chunk = emitDelta(mode, _buffer);
      _buffer = "";
      if (chunk) yield chunk;
    },

    reset(): void {
      mode = "text";
      thinkingTag = null;
      toolCallName = "";
      _buffer = "";
    },
  };
}

// ── Claude SSE Parser ──

/**
 * Parse Claude Web SSE stream with full event handling.
 * Yields normalized StreamChunk objects.
 */
export async function* parseClaudeSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Track state
  let currentBlockType: string | null = null;
  let currentBlockIndex = -1;
  const tagBuffer = createTagAwareBuffer();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        yield* processClaudeSSELine(buffer.trim(), tagBuffer, (type, idx) => {
          currentBlockType = type;
          currentBlockIndex = idx;
        });
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      yield* processClaudeSSELine(line.trim(), tagBuffer, (type, idx) => {
        currentBlockType = type;
        currentBlockIndex = idx;
      });
    }
  }

  // Flush tag buffer
  yield* tagBuffer.flush();
}

function* processClaudeSSELine(
  line: string,
  tagBuffer: TagAwareBuffer,
  onBlockChange: (type: string | null, index: number) => void,
): Generator<StreamChunk> {
  if (!line.startsWith("data:")) return;

  const dataStr = line.slice(5).trim();
  if (dataStr === "[DONE]" || !dataStr) return;

  let data: ClaudeSSEEvent;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return; // ignore malformed JSON
  }

  // ── message_start ──
  if (data.type === "message_start" && data.message) {
    // Conversation metadata available — could extract model/usage if needed
    return;
  }

  // ── content_block_start ──
  if (data.type === "content_block_start" && data.content_block) {
    onBlockChange(data.content_block.type, data.index ?? -1);

    if (data.content_block.type === "tool_use") {
      yield {
        type: "tool_call",
        toolCall: {
          id: data.content_block.id ?? `call_${Date.now()}`,
          name: data.content_block.name ?? "",
          arguments: "",
        },
      };
    }
    return;
  }

  // ── content_block_delta ──
  if (data.type === "content_block_delta" && data.delta) {
    const delta = data.delta;

    // Thinking content
    if (typeof delta.thinking === "string" && delta.thinking) {
      yield* tagBuffer.push(delta.thinking);
      // Also emit as thinking chunk if not already handled by tag buffer
      if (tagBuffer.mode !== "thinking") {
        yield { type: "thinking", content: delta.thinking };
      }
      return;
    }

    // Text content — pass through tag buffer
    if (typeof delta.text === "string" && delta.text) {
      yield* tagBuffer.push(delta.text);
      return;
    }

    // Tool use partial JSON
    if (typeof delta.partial_json === "string") {
      yield {
        type: "tool_call",
        content: delta.partial_json,
        toolCall: { id: "", name: "", arguments: delta.partial_json },
      };
      return;
    }
  }

  // ── content_block_stop ──
  if (data.type === "content_block_end") {
    onBlockChange(null, -1);
    return;
  }

  // ── message_delta ──
  if (data.type === "message_delta") {
    if (data.delta?.stop_reason) {
      yield { type: "done" };
    }
    return;
  }

  // ── message_end ──
  if (data.type === "message_end") {
    yield { type: "done" };
    return;
  }

  // ── Ping ──
  if (data.type === "ping") return;

  // ── Error ──
  if (data.type === "error") {
    yield { type: "error", error: JSON.stringify(data) };
    return;
  }

  // ── Fallback: generic content extraction ──
  // Handle OpenAI-compatible format (some providers proxy through)
  if (data.choices?.[0]?.delta) {
    const delta = data.choices[0].delta;
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      yield { type: "thinking", content: delta.reasoning_content };
    }
    if (typeof delta.content === "string" && delta.content) {
      yield { type: "text", content: delta.content };
    }
    return;
  }

  // Direct text fields
  if (typeof data.text === "string" && data.text) {
    yield* tagBuffer.push(data.text);
    return;
  }
  if (typeof data.content === "string" && data.content) {
    yield* tagBuffer.push(data.content);
    return;
  }
}
