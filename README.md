# LLM Gateway (llmgw)

OpenAI-compatible API gateway that routes requests to **free web-based LLM providers** using browser cookies — no API tokens required.

Based on [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token), stripped down to a standalone service.

## Supported Providers

| Provider | Type | Status | Models |
|----------|------|--------|--------|
| DeepSeek | HTTP | ✅ Done | deepseek-chat, deepseek-reasoner, search variants |
| Claude | HTTP | ✅ Done | claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-6 |
| Kimi | HTTP | ✅ Done | moonshot-v1-8k/32k/128k |
| Xiaomi MiMo | HTTP | ✅ Done | xiaomimo-chat, mimo-v2-pro |
| OpenAI Compat | HTTP | ✅ Done | Any OpenAI-compatible API |
| Ollama | HTTP | ✅ Done | Any local model |
| vLLM | HTTP | ✅ Done | Any local model |
| ChatGPT Web | Playwright | ✅ Done | gpt-4, gpt-4-turbo |
| Gemini Web | Playwright | ✅ Done | gemini-pro, gemini-ultra |
| Grok Web | Playwright | ✅ Done | grok-1, grok-2 |
| Qwen International | Playwright | ✅ Done | qwen3.5-plus, qwen3.5-turbo |
| Qwen China | Playwright | ✅ Done | Qwen3.5-Plus, Qwen3.5-Turbo |
| GLM (Zhipu) | Playwright | ✅ Done | glm-4-plus, glm-4-think |
| GLM International | Playwright | ✅ Done | GLM-4 Plus, GLM-4 Think |
| Doubao | Playwright | ✅ Done | doubao-seed-2.0, doubao-pro |
| Perplexity | Playwright | ✅ Done | perplexity-web, perplexity-pro |
| Kimi (Playwright) | Playwright | ✅ Done | moonshot-v1-8k/32k/128k |

### Provider 实现对照表（vs 原项目 openclaw-zero-token）

| Provider | 原项目实现方式 | 本项目状态 | 备注 |
|----------|-------------|-----------|------|
| DeepSeek | HTTP fetch + PoW | ✅ | 保留 PoW + WASM |
| Claude | HTTP fetch + cookie | ✅ | |
| Kimi | Playwright 浏览器 | ✅ HTTP + ✅ Playwright 两个版本 | |
| ChatGPT | Playwright 浏览器 | ✅ | DOM 交互 |
| Gemini | Playwright 浏览器 | ✅ | DOM 交互 |
| Grok | Playwright 浏览器 | ✅ | DOM 交互 |
| Qwen (国际) | Playwright 浏览器 | ✅ | |
| Qwen (国内) | Playwright 浏览器 | ✅ | |
| GLM | Playwright 浏览器 | ✅ | |
| GLM 国际 | Playwright 浏览器 | ✅ | |
| Doubao | HTTP fetch | ✅ Playwright 版 | HTTP 版需要复杂动态参数 |
| Xiaomi MiMo | HTTP fetch | ✅ | |
| Perplexity | Playwright 浏览器 | ✅ | |
| Manus | API key (付费) | ❌ 不需要 | 原项目标注 free quota，但需要 API key |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers (only if using Playwright providers)
npx playwright install chromium

# 3. Create config from example
cp config.example.json config.json

# 4. Edit config.json with your browser cookies

# 5. Start the server
npm start
```

## Getting Cookies

### DeepSeek
1. Open [chat.deepseek.com](https://chat.deepseek.com) in your browser
2. Log in
3. Open DevTools → Network tab
4. Copy the `Cookie` header from any request

### Claude
1. Open [claude.ai](https://claude.ai), log in
2. Copy cookies from DevTools
3. Also note your organization UUID

### Kimi / ChatGPT / Gemini / Grok / etc.
1. Open the website, log in
2. Open DevTools → Application → Cookies
3. Copy all cookies as a single string (`name1=value1; name2=value2`)

## API Usage

### Chat Completions (Streaming)

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Authorization: Bearer your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### List Models

```bash
curl http://localhost:3456/v1/models
```

### Health Check

```bash
curl http://localhost:3456/health
```

## Configuration

Edit `config.json`:

```jsonc
{
  "port": 3456,              // Server port (also via PORT env var)
  "apiKey": "secret",        // Optional API key (also via API_KEY env var)
  "providers": {
    "deepseek": {
      "_type": "deepseek",
      "cookie": "..."
    },
    "chatgpt": {
      "_type": "chatgpt",
      "cookie": "..."
    }
  },
  "modelMapping": {
    "deepseek-chat": "deepseek",
    "gpt-4": "chatgpt"
  }
}
```

### Environment Variables

- `PORT` — Override server port
- `CONFIG_PATH` — Override config file path
- `API_KEY` — Override API key

### Playwright Options

For Playwright-based providers, additional options:

```jsonc
{
  "_type": "chatgpt",
  "cookie": "...",
  "headless": true,          // default: true
  "browserPath": "/usr/bin/chromium",  // optional
  "cdpUrl": "http://127.0.0.1:9222"   // connect to existing Chrome
}
```

## Architecture

```
Client (OpenAI SDK) → HTTP Server → Model Router → Provider → Web API (free)
```

## Using with OpenAI SDKs

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3456/v1", api_key="key")
response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)
for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

## License

MIT
