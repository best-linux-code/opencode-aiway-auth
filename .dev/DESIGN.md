# opencode-aiway-auth Design

## 1. Goal

OpenCode plugin that bridges OpenCode with AI Way (New API fork) at configurable base URL (default `http://192.168.77.88`).

The plugin enables OpenCode to:

- authenticate against AI Way via Bearer API key
- discover models dynamically from `GET /v1/models`
- map AI Way capabilities to OpenCode model metadata
- call `POST /v1/chat/completions` through the standard OpenAI-compatible path

## 2. External Systems

### 2.1 OpenCode

Source: `/Users/claw/Documents/OpenCode_Project/Src/opencode`

Key contracts:

- plugin types: `packages/plugin/src/index.ts`
- provider model shape: `packages/opencode/src/provider/provider.ts`

### 2.2 AI Way

Runtime: `http://192.168.77.88` (configurable)

Endpoints:

- `GET /v1/models` — model list with extended capabilities
- `POST /v1/chat/completions` — OpenAI-compatible chat

No `/v1/health` endpoint exists. Connectivity is validated via `/v1/models`.

### 2.3 AI Way `/v1/models` Response Shape

Each model in the response includes an extended `capabilities` field beyond standard New API:

```json
{
  "id": "claude-opus-4-6",
  "object": "model",
  "created": 1626777600,
  "supported_endpoint_types": ["openai", "anthropic"],
  "capabilities": {
    "effort_levels": ["low", "medium", "high", "max"],
    "default_effort": "high",
    "default_thinking_type": "adaptive",
    "input_modalities": ["text", "image", "pdf"],
    "output_modalities": ["text"]
  }
}
```

Fields:

| Field | Type | Description |
|---|---|---|
| `effort_levels` | `string[]` or absent | Supported reasoning effort variants |
| `default_effort` | `string` or absent | Default effort level |
| `default_thinking_type` | `"adaptive" \| "enabled" \| "none"` | `adaptive` = model decides, `enabled` = always think, `none` = no thinking |
| `input_modalities` | `string[]` | Supported input types: `text`, `image`, `pdf`, `video` |
| `output_modalities` | `string[]` | Supported output types |

**Missing from API**: `context_window`, `max_output_tokens` — supplied by plugin built-in limits table.

## 3. Design Principles

1. Treat AI Way `/v1/models` as runtime source of truth for model list and capabilities.
2. Supplement missing token limits from a built-in table with conservative defaults for unknown models.
3. Keep the plugin thin — no custom fetch, no request body transformation. AI Way is OpenAI-compatible.
4. Do not fabricate capabilities the API does not report.
5. Support configurable base URL (not hardcoded).

## 4. Non-Goals

- No changes to AI Way backend
- No OpenCode core modifications
- No custom fetch interceptor (standard OpenAI-compat SDK handles requests)
- No hardcoded model list as primary source

## 5. Architecture

```
[OpenCode]
  -> [opencode-aiway-auth plugin]
    -> GET /v1/models  (discover + validate)
    -> return { baseURL, apiKey }
  -> [@ai-sdk/openai-compatible]
    -> POST /v1/chat/completions
  -> [AI Way server]
```

Plugin responsibilities:

- collect base URL and API key from user
- validate connectivity via `/v1/models`
- map AI Way capabilities to OpenCode model metadata
- supplement token limits from built-in table
- register provider and models into OpenCode
- persist provider config to `~/.config/opencode/opencode.json`

AI Way responsibilities:

- API key authentication
- model access control
- chat execution and streaming
- format conversion between providers

## 6. Project Structure

```
opencode-aiway-auth/
├── .dev/
│   ├── DESIGN.md
│   ├── REQUIREMENTS.md
│   ├── CONVENTIONS.md
│   └── TESTING.md
├── src/
│   ├── index.ts          # export plugin symbol
│   ├── plugin.ts         # auth, model discovery, provider patching
│   └── limits.ts         # built-in token limits table
├── test/
│   └── integration.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 7. Plugin Hook Plan

### 7.1 `auth`

Provider id: `aiway`

Loader:

1. read stored API key
2. `GET /v1/models` with Bearer auth
3. map each model: capabilities from API + limits from built-in table
4. `patchProviderModels()` — mutate provider.models in-place
5. `writeProviderConfig()` — persist to opencode.json
6. return `{ baseURL: "<base>/v1", apiKey }`

Methods:

- type: `api`
- prompts: base URL (text, default `http://192.168.77.88`) + API key (text)
- authorize: `GET /v1/models` to validate → return `{ type: "success", key }` or `{ type: "failed" }`

### 7.2 `chat.params` (optional)

- log request metadata (session, model, variant, effort)
- do not modify request options

### 7.3 Hooks NOT implemented

- `chat.headers` — not needed
- `experimental.chat.messages.transform` — not needed (AI Way accepts OpenAI messages directly)

## 8. Model Metadata Mapping

### 8.1 From API (`capabilities`)

| AI Way field | OpenCode field | Mapping |
|---|---|---|
| `id` | `id` | direct |
| `input_modalities` contains `image` | `capabilities.input.image` | boolean |
| `input_modalities` contains `pdf` | `capabilities.input.pdf` | boolean |
| `input_modalities` contains `video` | `capabilities.input.video` | boolean |
| `effort_levels` present | `capabilities.reasoning` | `true` |
| `effort_levels` values | `variants` | one variant per level |
| `default_thinking_type` != `none` | `capabilities.reasoning` | `true` |
| any non-text input modality | `attachment` | `true` |

### 8.2 From Built-in Limits Table

| Model pattern | context | output |
|---|---|---|
| `claude-opus-4-6` | 200000 | 32000 |
| `claude-sonnet-4-6` | 200000 | 16384 |
| `claude-haiku-4-5` | 200000 | 16384 |
| `gpt-5.4` / `gpt-5.4-mini` | 128000 | 16384 |
| `gpt-5.3-codex` | 128000 | 16384 |
| `gemini-3.1-pro-preview` | 1000000 | 65536 |
| `kimi-k2.5` | 128000 | 16384 |
| default (unknown) | 128000 | 4096 |

## 9. Variant Strategy

- One variant per `effort_levels` value (e.g. `low`, `medium`, `high`, `max`, `xhigh`)
- Each variant sets `reasoning_effort` to that level
- Models with `default_thinking_type` = `adaptive` or `enabled`: add `thinking-disabled` variant
- No `thinking-enabled` variant auto-created — thinking is already the default for those models

## 10. Auth and Config

### 10.1 Auth mode

API-key auth. User inputs base URL + API key during login.

### 10.2 Config persistence

Plugin writes only the `aiway` provider block in `~/.config/opencode/opencode.json`. Never touches other providers.

### 10.3 Runtime refresh

On each plugin load: fetch `/v1/models` → re-patch provider models → optionally refresh persisted config.

## 11. Logging

- Plugin lifecycle logs to `/tmp/opencode-aiway-auth.log`
- Never log API keys
- Log model count, request metadata (session, model, variant)
