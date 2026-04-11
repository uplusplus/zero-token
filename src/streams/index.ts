/**
 * Unified stream parsers.
 *
 * Each parser converts a platform-specific response stream into a
 * normalized AsyncGenerator<StreamChunk>.
 */

export { parseSSEStream, parseConnectJSONStream } from "./parsers.js";
export type { StreamChunk } from "./parsers.js";

export { parseClaudeSSEStream, createTagAwareBuffer } from "./claude-parser.js";
export type { TagAwareBuffer } from "./claude-parser.js";
