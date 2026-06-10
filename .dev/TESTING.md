# opencode-aiway-auth Testing

## 1. Objective

Prove the plugin works against a real AI Way server while preserving model fidelity.

## 2. Testing Layers

### 2.1 Local Static

- build passes
- typecheck passes
- LSP diagnostics clean

### 2.2 Remote Integration

Target: `http://192.168.77.88`

### T-1 Connectivity

- `GET /v1/models` with valid auth returns model list
- invalid key returns 401

### T-2 Model Discovery

- response contains expected models (13 as of writing)
- each model has `capabilities` field
- `capabilities` includes `input_modalities` and `default_thinking_type`
- `native_endpoint_types` is present for models whose upstream-native protocol is known

### T-3 Protocol Discovery

- models with `native_endpoint_types: ["responses"]` map to `@ai-sdk/openai`
- models with `native_endpoint_types: ["messages"]` map to `@ai-sdk/anthropic`
- models with `native_endpoint_types: ["completions"]` map to `@ai-sdk/openai-compatible`
- if `native_endpoint_types` is absent, model ID and `supported_endpoint_types` provide fallback

### T-4 Model Metadata Mapping

- models with `effort_levels` get corresponding variants
- models with `image` in `input_modalities` have `capabilities.input.image = true`
- models with `pdf` in `input_modalities` have `capabilities.input.pdf = true`
- all models have `limit.context > 0` and `limit.output > 0`

### T-5 Provider Config

- `opencode.jsonc` updated with `aiway` provider block
- JSONC comments and trailing commas remain valid after provider updates
- stale `aiway` provider block is removed from legacy `opencode.json`
- existing config not destroyed
- provider `npm` is `@ai-sdk/openai-compatible`
- provider `api` matches configured base URL + `/v1`
- model `provider.npm` matches the inferred protocol

### T-6 Request Smoke

- at least one request succeeds through each configured native protocol when available

### T-7 Variant Behavior

- select a model with `effort_levels`
- verify variant with specific effort level is available
- verify the selected variant populates the protocol-specific provider option:
  `anthropic.effort`, `openai.reasoningEffort`, or `openaiCompatible.reasoningEffort`

### T-8 Unknown Model Fallback

- if a model not in limits table appears, it gets default limits (128000/4096)

## 3. Failure Criteria

- model metadata incomplete or wrong
- variant exists in OpenCode but unsupported by AI Way
- API key logged in plain text
- unrelated config destroyed
