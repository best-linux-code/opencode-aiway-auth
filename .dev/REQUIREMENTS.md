# opencode-aiway-auth Requirements

## 1. Objective

Build an OpenCode plugin that allows OpenCode to authenticate with AI Way and use its models through the standard OpenAI-compatible provider path.

## 2. Hard Constraints

1. Plugin code lives under `/Users/claw/Documents/OpenCode_Project/Plugins/opencode-aiway-auth`
2. AI Way source code must not be modified
3. Remote testing against `http://192.168.77.88`
4. Base URL must be configurable (not hardcoded)

## 3. Functional Requirements

### FR-1 Plugin Identity

- package name: `opencode-aiway-auth`
- exports a stable plugin symbol
- builds to a loadable artifact

### FR-2 Auth Integration

- collect base URL (default `http://192.168.77.88`) and API key from user
- validate connectivity via `GET /v1/models`
- return auth data usable by OpenCode provider flow
- no secrets logged

### FR-3 Model Discovery

- fetch models dynamically from `GET /v1/models`
- parse extended `capabilities` field (effort_levels, default_thinking_type, input_modalities, output_modalities)
- no hardcoded model list as primary source

### FR-4 Provider Registration

- provider id: `aiway`
- npm: `@ai-sdk/openai-compatible`
- api: `<base_url>/v1`
- config merges safely into existing OpenCode config

### FR-5 Model Metadata Fidelity

- context window from built-in limits table
- max output tokens from built-in limits table
- tool support: `true` for all models (AI Way handles routing)
- input modalities mapped from `capabilities.input_modalities`
- reasoning flag from `effort_levels` presence or `default_thinking_type` != `none`

### FR-6 Variant Generation

- one variant per `effort_levels` value with `reasoning_effort` set
- `thinking-disabled` variant for models with `default_thinking_type` = `adaptive` or `enabled`
- no variant for unsupported effort levels
- unknown models with no `effort_levels` get no effort variants

### FR-7 Token Limits

Built-in limits table covers all 13 known models with conservative default (128000/4096) for unknown models.

### FR-8 Configurable Base URL

- default: `http://192.168.77.88`
- user can override during login
- stored and reused across sessions

### FR-9 Streaming Compatibility

- no custom fetch needed — `@ai-sdk/openai-compatible` handles streaming natively
- plugin does not intercept or wrap responses

### FR-10 Documentation

- README: installation, login flow, model sync behavior
- `.dev/` docs aligned with implementation

## 4. Non-Functional Requirements

### NFR-1 Safety

- no secret leakage in logs
- no destructive writes to unrelated OpenCode config

### NFR-2 Maintainability

- follow `opencode-anthropic-claude-auth` structural pattern
- keep code under 500 lines total

### NFR-3 Accuracy

- every surfaced capability must match AI Way API response
- unsupported capabilities must not be fabricated

## 5. Acceptance Test Matrix

1. plugin builds successfully
2. plugin loads in OpenCode
3. auth login succeeds against `http://192.168.77.88`
4. `/v1/models` results visible through patched OpenCode models
5. model capabilities match API response
6. at least one chat completion succeeds
7. at least one reasoning-effort variant transmitted correctly
8. image-capable models preserve that capability
9. unknown models get conservative defaults
