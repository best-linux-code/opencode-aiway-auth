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

### T-3 Model Metadata Mapping

- models with `effort_levels` get corresponding variants
- models with `image` in `input_modalities` have `capabilities.input.image = true`
- models with `pdf` in `input_modalities` have `capabilities.input.pdf = true`
- all models have `limit.context > 0` and `limit.output > 0`

### T-4 Provider Config

- `opencode.json` updated with `aiway` provider block
- existing config not destroyed
- provider `npm` is `@ai-sdk/openai-compatible`
- provider `api` matches configured base URL + `/v1`

### T-5 Chat Completion

- at least one non-stream request succeeds
- at least one stream request succeeds

### T-6 Variant Behavior

- select a model with `effort_levels`
- verify variant with specific effort level is available

### T-7 Unknown Model Fallback

- if a model not in limits table appears, it gets default limits (128000/4096)

## 3. Failure Criteria

- model metadata incomplete or wrong
- variant exists in OpenCode but unsupported by AI Way
- API key logged in plain text
- unrelated config destroyed
