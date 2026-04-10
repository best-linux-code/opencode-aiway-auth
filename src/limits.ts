/**
 * Built-in token limits for known AI Way models.
 * AI Way /v1/models does not return context_window or max_output_tokens,
 * so we supply them here.
 */

interface ModelLimits {
  context: number
  output: number
}

const KNOWN_LIMITS: Record<string, ModelLimits> = {
  "claude-opus-4-6": { context: 200000, output: 32000 },
  "claude-sonnet-4-6": { context: 200000, output: 16384 },
  "claude-haiku-4-5": { context: 200000, output: 16384 },
  "gpt-5.4": { context: 128000, output: 16384 },
  "gpt-5.4-mini": { context: 128000, output: 16384 },
  "gpt-5.3-codex": { context: 128000, output: 16384 },
  "gemini-3.1-pro-preview": { context: 1000000, output: 65536 },
  "kimi-k2.5": { context: 128000, output: 16384 },
  "glm-5.1": { context: 128000, output: 4096 },
  "grok-code-fast-1": { context: 128000, output: 4096 },
  "mimo-v2-pro": { context: 128000, output: 4096 },
  "minimax-m2.7": { context: 128000, output: 4096 },
  "qwen3.6-plus": { context: 128000, output: 4096 },
}

const DEFAULT_LIMITS: ModelLimits = { context: 128000, output: 4096 }

export function getLimits(id: string): ModelLimits {
  return KNOWN_LIMITS[id] ?? DEFAULT_LIMITS
}
