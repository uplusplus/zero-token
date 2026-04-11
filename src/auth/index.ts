/**
 * Auth modules — browser-based credential capture for all platforms.
 * Standalone — no OpenClaw dependencies.
 */

export { runAuthFlow, getCookies, formatCookies } from "./base.js";
export type { AuthResult, AuthOptions, AuthHooks } from "./base.js";

export { loginClaudeWeb } from "./claude-web-auth.js";
export type { ClaudeWebAuthResult } from "./claude-web-auth.js";

export { loginDeepSeekWeb } from "./deepseek-web-auth.js";
export type { DeepSeekWebAuthResult } from "./deepseek-web-auth.js";

export { loginKimiWeb } from "./kimi-web-auth.js";
export type { KimiWebAuthResult } from "./kimi-web-auth.js";

export { loginDoubaoWeb } from "./doubao-web-auth.js";
export type { DoubaoWebAuthResult } from "./doubao-web-auth.js";

export { loginXiaomiMiMoWeb } from "./xiaomimo-web-auth.js";
export type { XiaomiMiMoWebAuthResult } from "./xiaomimo-web-auth.js";

export { loginQwenWeb } from "./qwen-web-auth.js";
export type { QwenWebAuthResult } from "./qwen-web-auth.js";

export { loginQwenCnWeb } from "./qwen-cn-web-auth.js";
export type { QwenCnWebAuthResult } from "./qwen-cn-web-auth.js";

export { loginGlmWeb } from "./glm-web-auth.js";
export { loginGlmIntlWeb } from "./glm-intl-web-auth.js";
export { loginPerplexityWeb } from "./perplexity-web-auth.js";
export { loginChatGPTWeb } from "./chatgpt-web-auth.js";
export type { ChatGPTWebAuthResult } from "./chatgpt-web-auth.js";
export { loginGeminiWeb } from "./gemini-web-auth.js";
export { loginGrokWeb } from "./grok-web-auth.js";
