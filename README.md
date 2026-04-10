# opencode-aiway-auth

OpenCode plugin for AI Way (New API) — authentication and model discovery.

## Installation

Add to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": [
    "/path/to/opencode-aiway-auth"
  ]
}
```

Or install from the plugin directory:

```bash
cd /path/to/opencode-aiway-auth
npm install
npm run build
```

## Setup

1. Start OpenCode
2. Select **AI Way API Key** as auth provider
3. Enter your AI Way server URL (default: `http://192.168.77.88`)
4. Enter your API key

The plugin will:

- Validate connectivity via `GET /v1/models`
- Discover all available models and their capabilities
- Register them as an OpenCode provider (`aiway`)
- Persist config to `~/.config/opencode/opencode.json`

## Models

Models are discovered dynamically from the AI Way server. The plugin maps:

- **Capabilities**: effort levels, thinking mode, input modalities (text, image, pdf, video)
- **Variants**: one per effort level (low, medium, high, max, xhigh) + thinking-disabled
- **Limits**: context window and max output tokens from a built-in table

## Logging

Logs are written to `/tmp/opencode-aiway-auth.log`. API keys are never logged.

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run typecheck    # Type-check only
npm run integration  # Run integration tests against AI Way
```
