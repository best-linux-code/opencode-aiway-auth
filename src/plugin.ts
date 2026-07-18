import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type JSONPath,
  type ParseError,
} from "jsonc-parser"

// ── Constants ──

const PROVIDER_ID = "aiway"
const PROVIDER_NAME = "AI Way"
const DEFAULT_BASE_URL = "http://192.168.77.88"
const LOG_FILE = "/tmp/opencode-aiway-auth.log"
const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible"
const OPENAI_NPM = "@ai-sdk/openai"
const ANTHROPIC_NPM = "@ai-sdk/anthropic"
const CONFIG_JSON = "opencode.json"
const CONFIG_JSONC = "opencode.jsonc"
const JSONC_FORMATTING: FormattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
  insertFinalNewline: true,
}
const PROVIDER_CONFIG_PATH: JSONPath = ["provider", PROVIDER_ID]
const PROVIDER_ROOT_PATH: JSONPath = ["provider"]

const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" })

function log(msg: string): void {
  logStream.write(`[${new Date().toISOString()}] [aiway] ${msg}\n`)
}

// ── AI Way API Types ──

interface AiWayCapabilities {
  effort_levels?: string[]
  default_effort?: string
  default_thinking_type?: "adaptive" | "enabled" | "none"
  context_window?: number
  max_output?: number
  input_modalities?: string[]
  output_modalities?: string[]
}

interface AiWayRateFields {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
}

interface AiWayPricingTier extends AiWayRateFields {
  name?: string
  max_input_tokens?: number
  min_input_tokens?: number
}

interface AiWayPricing extends AiWayRateFields {
  currency?: string
  billing_mode?: string
  unit?: string
  request?: number
  tiers?: AiWayPricingTier[]
  billing_expression?: string
}

interface AiWayModel {
  id: string
  object: string
  created: number
  supported_endpoint_types?: string[]
  native_endpoint_types?: string[]
  display_name?: string
  capabilities?: AiWayCapabilities
  pricing?: AiWayPricing
}

interface OpenCodeCostRates {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
}

interface OpenCodeCost extends OpenCodeCostRates {
  context_over_200k?: OpenCodeCostRates
  tiers?: Array<
    OpenCodeCostRates & {
      tier: { type: "context"; size: number }
    }
  >
}

interface AiWayModelsResponse {
  object: string
  data: AiWayModel[]
  success?: boolean
}

// ── Config Helpers ──

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(xdg, "opencode")
}

function configJsonPath(): string {
  return path.join(configDir(), CONFIG_JSON)
}

function configJsoncPath(): string {
  return path.join(configDir(), CONFIG_JSONC)
}

function configPath(): string {
  const jsonc = configJsoncPath()
  if (fs.existsSync(jsonc)) return jsonc

  const json = configJsonPath()
  if (fs.existsSync(json)) return json

  return jsonc
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function hasOwnKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function parseConfigText(text: string, file: string): Record<string, unknown> {
  if (!text.trim()) return {}

  const errors: ParseError[] = []
  const parsed = parse(text, errors, {
    allowTrailingComma: true,
    allowEmptyContent: true,
    disallowComments: false,
  })

  if (errors.length > 0) {
    const first = errors[0]
    throw new Error(`${file}: ${printParseErrorCode(first.error)} at offset ${first.offset}`)
  }

  const cfg = asRecord(parsed)
  if (!cfg) throw new Error(`${file}: expected top-level object`)
  return cfg
}

function readConfigFile(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {}
  return parseConfigText(fs.readFileSync(file, "utf-8"), file)
}

function mutationBaseText(file: string): string {
  if (!fs.existsSync(file)) return "{\n}\n"
  const text = fs.readFileSync(file, "utf-8")
  return text.trim() ? text : "{\n}\n"
}

function writeTextAtomic(file: string, text: string): void {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `${path.basename(file)}.tmp-${process.pid}-${Date.now().toString(36)}`)
  fs.mkdirSync(dir, { recursive: true })
  try {
    fs.writeFileSync(tmp, text.endsWith("\n") ? text : `${text}\n`, "utf-8")
    fs.renameSync(tmp, file)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch {}
    throw err
  }
}

function updateConfigValue(file: string, jsonPath: JSONPath, value: unknown): boolean {
  const text = mutationBaseText(file)
  parseConfigText(text, file)
  const edits = modify(text, jsonPath, value, { formattingOptions: JSONC_FORMATTING })
  if (edits.length === 0) return false
  writeTextAtomic(file, applyEdits(text, edits))
  return true
}

function removeConfigValue(file: string, jsonPath: JSONPath): boolean {
  if (!fs.existsSync(file)) return false
  const text = fs.readFileSync(file, "utf-8")
  if (!text.trim()) return false
  parseConfigText(text, file)
  const edits = modify(text, jsonPath, undefined, { formattingOptions: JSONC_FORMATTING })
  if (edits.length === 0) return false
  writeTextAtomic(file, applyEdits(text, edits))
  return true
}

function removeProviderConfigFromFile(file: string): boolean {
  if (!fs.existsSync(file)) return false

  const cfg = readConfigFile(file)
  const providers = asRecord(cfg.provider)
  if (!providers || !hasOwnKey(providers, PROVIDER_ID)) return false

  removeConfigValue(file, PROVIDER_CONFIG_PATH)

  const nextProviders = asRecord(readConfigFile(file).provider)
  if (nextProviders && Object.keys(nextProviders).length === 0) {
    removeConfigValue(file, PROVIDER_ROOT_PATH)
  }

  return true
}

function cleanupLegacyProviderConfig(target: string): void {
  const legacy = configJsonPath()
  if (path.resolve(target) === path.resolve(legacy)) return
  if (removeProviderConfigFromFile(legacy)) {
    log(`Removed stale provider config from ${path.basename(legacy)}`)
  }
}

// ── API ──

async function fetchModels(base: string, key: string): Promise<AiWayModel[]> {
  const res = await fetch(`${base}/v1/models`, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`GET /v1/models failed: HTTP ${res.status}`)
  const body = (await res.json()) as AiWayModelsResponse
  return Array.isArray(body.data) ? body.data : []
}

// ── Model Mapping ──

type Protocol = "chat_completions" | "responses" | "messages"
type ProtocolSource = "native_endpoint_types" | "supported_endpoint_types" | "model_id" | "default"
type AiSdkPackage = typeof OPENAI_COMPATIBLE_NPM | typeof OPENAI_NPM | typeof ANTHROPIC_NPM

interface ProtocolChoice {
  protocol: Protocol
  npm: AiSdkPackage
  source: ProtocolSource
  endpointType?: string
}

function hasModality(caps: AiWayCapabilities | undefined, mod: string): boolean {
  return caps?.input_modalities?.includes(mod) ?? false
}

function supportsReasoning(caps: AiWayCapabilities | undefined): boolean {
  if (!caps) return false
  if (caps.effort_levels && caps.effort_levels.length > 0) return true
  return caps.default_thinking_type !== undefined && caps.default_thinking_type !== "none"
}

// OpenCode wraps the entire flat options bag under a provider key
// (openai / anthropic / aiway) before the AI SDK reads it.
// Nested options.providerOptions is therefore the wrong layer: for
// @ai-sdk/openai-compatible it leaks into the upstream HTTP body as an
// unknown key. Inject only flat fields that OpenCode already merges.
function variantEffort(variantOptions: Record<string, unknown>): string | undefined {
  if (typeof variantOptions.reasoningEffort === "string") {
    return variantOptions.reasoningEffort
  }
  if (typeof variantOptions.effort === "string") {
    return variantOptions.effort
  }
  return undefined
}

function applyFlatVariantOptions(
  options: Record<string, unknown>,
  protocol: Protocol,
  variantOptions: Record<string, unknown>,
): void {
  const effort = variantEffort(variantOptions)

  if (effort) {
    if (options.reasoningEffort === undefined) options.reasoningEffort = effort
    if (protocol === "messages" && options.effort === undefined) options.effort = effort
  }

  if (variantOptions.thinking !== undefined && options.thinking === undefined) {
    options.thinking = variantOptions.thinking
  }
}

function protocolFromNpm(npm: unknown): Protocol {
  if (npm === ANTHROPIC_NPM) return "messages"
  if (npm === OPENAI_NPM) return "responses"
  return "chat_completions"
}

function buildVariants(
  caps: AiWayCapabilities | undefined,
  protocol: Protocol,
): Record<string, Record<string, unknown>> | undefined {
  if (!caps) return undefined
  const variants: Record<string, Record<string, unknown>> = {}

  if (caps.effort_levels) {
    for (const level of caps.effort_levels) {
      const variantOptions: Record<string, unknown> = { reasoningEffort: level }
      if (protocol === "messages") variantOptions.effort = level
      variants[level] = variantOptions
    }
  }

  if (caps.default_thinking_type === "adaptive" || caps.default_thinking_type === "enabled") {
    variants["thinking-disabled"] = { thinking: { type: "disabled" } }
  }

  return Object.keys(variants).length > 0 ? variants : undefined
}

function npmForProtocol(protocol: Protocol): AiSdkPackage {
  switch (protocol) {
    case "responses":
      return OPENAI_NPM
    case "messages":
      return ANTHROPIC_NPM
    case "chat_completions":
      return OPENAI_COMPATIBLE_NPM
  }
}

function normalizeEndpointType(value: string): Protocol | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\/?v1\/?/, "")
    .replace(/^\/+/, "")
    .replace(/[\s./-]+/g, "_")

  switch (normalized) {
    case "responses":
    case "response":
    case "openai_response":
    case "openai_responses":
    case "openai_response_compact":
    case "openai_responses_compact":
      return "responses"
    case "messages":
    case "message":
    case "claude_messages":
    case "anthropic_messages":
    case "anthropic":
      return "messages"
    case "completions":
    case "completion":
    case "chat_completions":
    case "chat_completion":
    case "openai":
    case "openai_compatible":
    case "openai_compatible_chat":
      return "chat_completions"
  }
  return undefined
}

function choiceFromEndpointTypes(types: string[] | undefined, source: ProtocolSource): ProtocolChoice | undefined {
  for (const type of types ?? []) {
    const protocol = normalizeEndpointType(type)
    if (protocol) {
      return {
        protocol,
        npm: npmForProtocol(protocol),
        source,
        endpointType: type,
      }
    }
  }
  return undefined
}

function choiceFromModelID(id: string): ProtocolChoice | undefined {
  const model = id.toLowerCase().trim()
  if (model.includes("claude") || model.startsWith("anthropic/")) {
    return { protocol: "messages", npm: ANTHROPIC_NPM, source: "model_id" }
  }
  if (
    (/(?:^|\/)gpt-5(?:[.-]|$)/.test(model) && !model.includes("gpt-5-chat")) ||
    ["o3-pro", "o3-deep-research", "o4-mini-deep-research"].some((item) => model.includes(item))
  ) {
    return { protocol: "responses", npm: OPENAI_NPM, source: "model_id" }
  }
  return undefined
}

function chooseProtocol(m: AiWayModel): ProtocolChoice {
  return choiceFromEndpointTypes(m.native_endpoint_types, "native_endpoint_types")
    ?? choiceFromModelID(m.id)
    ?? choiceFromEndpointTypes(m.supported_endpoint_types, "supported_endpoint_types")
    ?? { protocol: "chat_completions", npm: OPENAI_COMPATIBLE_NPM, source: "default" }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function ratesFrom(fields: AiWayRateFields | undefined): OpenCodeCostRates {
  const rates: OpenCodeCostRates = {
    input: isFiniteNumber(fields?.input) ? fields.input : 0,
    output: isFiniteNumber(fields?.output) ? fields.output : 0,
  }
  if (isFiniteNumber(fields?.cache_read)) rates.cache_read = fields.cache_read
  if (isFiniteNumber(fields?.cache_write)) rates.cache_write = fields.cache_write
  return rates
}

// OpenCode: contextTokens > tier.size. AI Way long_context min_input_tokens is exclusive (e.g. 272001).
function higherTierSize(tier: AiWayPricingTier): number | undefined {
  if (isFiniteNumber(tier.min_input_tokens) && tier.min_input_tokens > 0) {
    return Math.max(0, tier.min_input_tokens - 1)
  }
  if (isFiniteNumber(tier.max_input_tokens) && tier.max_input_tokens > 0) {
    return tier.max_input_tokens
  }
  return undefined
}

function sortPricingTiers(tiers: readonly AiWayPricingTier[]): AiWayPricingTier[] {
  return [...tiers].sort((a, b) => {
    const aHigher = isFiniteNumber(a.min_input_tokens) ? 1 : 0
    const bHigher = isFiniteNumber(b.min_input_tokens) ? 1 : 0
    if (aHigher !== bHigher) return aHigher - bHigher
    const aKey = isFiniteNumber(a.max_input_tokens)
      ? a.max_input_tokens
      : isFiniteNumber(a.min_input_tokens)
        ? a.min_input_tokens
        : 0
    const bKey = isFiniteNumber(b.max_input_tokens)
      ? b.max_input_tokens
      : isFiniteNumber(b.min_input_tokens)
        ? b.min_input_tokens
        : 0
    return aKey - bKey
  })
}

// USD/1M token rates map 1:1 into OpenCode cost — never divide by 1e6 (OpenCode does that at calc time).
export function mapCost(pricing: AiWayPricing | undefined): OpenCodeCost {
  if (!pricing) return { input: 0, output: 0 }

  const mode = pricing.billing_mode

  if (mode === "request") {
    return { input: 0, output: 0 }
  }

  if (mode === "tiered") {
    const rawTiers = pricing.tiers
    if (!rawTiers || rawTiers.length === 0) return { input: 0, output: 0 }

    const sorted = sortPricingTiers(rawTiers)
    const base = ratesFrom(sorted[0])
    const cost: OpenCodeCost = { ...base }

    const openCodeTiers: NonNullable<OpenCodeCost["tiers"]> = []
    for (const tier of sorted.slice(1)) {
      const size = higherTierSize(tier)
      if (size === undefined) continue
      const rates = ratesFrom(tier)
      openCodeTiers.push({
        ...rates,
        tier: { type: "context", size },
      })
      if (size >= 150_000 && size <= 300_000 && cost.context_over_200k === undefined) {
        cost.context_over_200k = rates
      }
    }
    if (openCodeTiers.length > 0) cost.tiers = openCodeTiers
    return cost
  }

  if (isFiniteNumber(pricing.input) || isFiniteNumber(pricing.output)) {
    return ratesFrom(pricing)
  }

  return { input: 0, output: 0 }
}

function mapModel(m: AiWayModel, base: string): Record<string, unknown> {
  const caps = m.capabilities
  const context = caps?.context_window ?? 128000
  const output = caps?.max_output ?? 4096
  const image = hasModality(caps, "image")
  const pdf = hasModality(caps, "pdf")
  const video = hasModality(caps, "video")
  const attachment = image || pdf || video
  const reasoning = supportsReasoning(caps)
  const protocol = chooseProtocol(m)
  const variants = buildVariants(caps, protocol.protocol)

  return {
    id: m.id,
    providerID: PROVIDER_ID,
    name: m.display_name || m.id,
    attachment,
    modalities: {
      input: caps?.input_modalities ?? ["text"],
      output: caps?.output_modalities ?? ["text"],
    },
    api: {
      id: m.id,
      url: `${base}/v1`,
      npm: protocol.npm,
    },
    provider: {
      npm: protocol.npm,
    },
    reasoning,
    capabilities: {
      temperature: true,
      reasoning,
      attachment,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image,
        video,
        pdf,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: mapCost(m.pricing),
    limit: {
      context,
      output,
    },
    headers: {},
    options: {},
    variants: variants ?? {},
  }
}

// ── Provider Patching ──

function patchProvider(
  provider: Record<string, unknown> | undefined,
  models: AiWayModel[],
  base: string,
): void {
  const target = provider ?? {}
  const existing = (target.models ?? {}) as Record<string, Record<string, unknown>>

  for (const m of models) {
    existing[m.id] = mapModel(m, base)
  }

  target.models = existing
}

function writeProviderConfig(models: AiWayModel[], base: string): void {
  const target = configPath()
  const cfg = readConfigFile(target)
  const providers = asRecord(cfg.provider) ?? {}
  const current = asRecord(providers[PROVIDER_ID]) ?? {}
  const modelsRecord: Record<string, Record<string, unknown>> = {}

  for (const m of models) {
    modelsRecord[m.id] = mapModel(m, base)
  }

  const providerConfig = {
    ...current,
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    api: `${base}/v1`,
    npm: OPENAI_COMPATIBLE_NPM,
    env: [],
    models: modelsRecord,
  }

  updateConfigValue(target, PROVIDER_CONFIG_PATH, providerConfig)
  cleanupLegacyProviderConfig(target)
  log(`Wrote provider config: ${Object.keys(modelsRecord).length} models to ${path.basename(target)}`)
}

function removeProviderConfig(): void {
  const removedFiles: string[] = []
  for (const file of [configJsoncPath(), configJsonPath()]) {
    if (removeProviderConfigFromFile(file)) {
      removedFiles.push(path.basename(file))
    }
  }
  if (removedFiles.length > 0) {
    log(`Removed provider config from ${removedFiles.join(", ")}`)
  }
}

function ensureProviderConfig(): void {
  const target = configPath()
  const cfg = readConfigFile(target)
  const providers = asRecord(cfg.provider) ?? {}
  if (hasOwnKey(providers, PROVIDER_ID)) return

  updateConfigValue(target, PROVIDER_CONFIG_PATH, {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    api: `${DEFAULT_BASE_URL}/v1`,
    npm: OPENAI_COMPATIBLE_NPM,
    env: [],
    models: {},
  })
  cleanupLegacyProviderConfig(target)
  log(`Bootstrap: wrote minimal provider config to ${path.basename(target)}`)
}

// ── Plugin Export ──

export const AiWayAuthPlugin: Plugin = async () => {
  log("Plugin initializing")

  // Cleanup stale config when no auth
  try {
    const authPath = path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
      "opencode",
      "auth.json",
    )
    let hasAuth = false
    try {
      const data = JSON.parse(fs.readFileSync(authPath, "utf-8")) as Record<string, unknown>
      const entry = data[PROVIDER_ID] as Record<string, unknown> | undefined
      hasAuth = entry?.type === "api" && typeof entry?.key === "string" && entry.key !== ""
    } catch {}
    if (!hasAuth) {
      removeProviderConfig()
    } else {
      ensureProviderConfig()
    }
  } catch (e) {
    log(`Config cleanup error: ${e instanceof Error ? e.message : String(e)}`)
  }

  return {
    auth: {
      provider: PROVIDER_ID,

      async loader(_getAuth: unknown, provider: unknown) {
        const prov = typeof provider === "object" && provider !== null
          ? provider as Record<string, unknown>
          : undefined
        const base = typeof prov?.api === "string" && prov.api.trim()
          ? prov.api.replace(/\/v1\/?$/, "").trim()
          : DEFAULT_BASE_URL
        const auth = typeof _getAuth === "function" ? await (_getAuth as () => Promise<Record<string, unknown>>)() : undefined
        const key = typeof auth?.key === "string" ? auth.key : ""

        if (!key) {
          log("No API key available, cleaning up provider config")
          try { removeProviderConfig() } catch {}
          return {}
        }

        log(`Loader: base=${base}`)

        let models: AiWayModel[] = []
        try {
          models = await fetchModels(base, key)
          log(`Fetched ${models.length} models`)
        } catch (e) {
          log(`fetchModels failed: ${e instanceof Error ? e.message : String(e)}`)
        }

        if (models.length > 0 && prov) {
          patchProvider(prov, models, base)
        }

        try {
          writeProviderConfig(models, base)
        } catch (e) {
          log(`writeProviderConfig failed: ${e instanceof Error ? e.message : String(e)}`)
        }

        for (const m of models) {
          const caps = m.capabilities
          const efforts = caps?.effort_levels
          const protocol = chooseProtocol(m)
          log(`  ${m.id}: protocol=${protocol.protocol}/${protocol.npm} source=${protocol.source}${protocol.endpointType ? `(${protocol.endpointType})` : ""}, thinking=${caps?.default_thinking_type ?? "unknown"}${efforts ? `, effort=[${efforts}]` : ""}, input=[${caps?.input_modalities?.join(",") ?? "text"}]`)
        }

        return {
          baseURL: `${base}/v1`,
          apiKey: key,
        }
      },

      methods: [
        {
          type: "api" as const,
          label: "AI Way API Key",
          prompts: [
            {
              type: "text" as const,
              key: "base_url",
              message: "AI Way server URL",
              placeholder: DEFAULT_BASE_URL,
            },
            {
              type: "text" as const,
              key: "api_key",
              message: "AI Way API key",
              placeholder: "sk-...",
            },
          ],
          async authorize(inputs?: Record<string, string>) {
            const base = inputs?.base_url?.trim() || DEFAULT_BASE_URL
            const key = inputs?.api_key?.trim() || ""

            if (!key) {
              log("[login] No API key provided")
              return { type: "failed" as const }
            }

            log(`[login] Connecting to ${base}`)

            try {
              const models = await fetchModels(base, key)
              log(`[login] Success: ${models.length} models`)

              try {
                writeProviderConfig(models, base)
              } catch (e) {
                log(`[login] writeProviderConfig failed: ${e instanceof Error ? e.message : String(e)}`)
              }

              return { type: "success" as const, key }
            } catch (e) {
              log(`[login] Failed: ${e instanceof Error ? e.message : String(e)}`)
              return { type: "failed" as const }
            }
          },
        },
      ],
    },

    "chat.params": async (input, output) => {
      if (input.provider.id !== PROVIDER_ID) return

      const userVariant = (input.message as any)?.model?.variant
        ?? (input as any)?.variant
      const variants = (input.model as any).variants
      const npm = (input.model as any)?.api?.npm ?? (input.model as any)?.provider?.npm
      const protocol = protocolFromNpm(npm)

      // If variant was selected but flat effort fields are missing from options,
      // inject them from the model's variants config. Flat only — OpenCode wraps
      // this bag under the SDK provider key; nested providerOptions would leak.
      if (userVariant && variants?.[userVariant]) {
        const variantOptions = variants[userVariant]
        if (!output.options.reasoningEffort && variantOptions.reasoningEffort) {
          output.options.reasoningEffort = variantOptions.reasoningEffort
        }
        applyFlatVariantOptions(output.options as Record<string, unknown>, protocol, variantOptions)
      } else if (typeof output.options.reasoningEffort === "string") {
        applyFlatVariantOptions(
          output.options as Record<string, unknown>,
          protocol,
          { reasoningEffort: output.options.reasoningEffort },
        )
      }

      log(
        `[request] model=${input.model.id} variant=${userVariant ?? "none"} protocol=${protocol}`
        + ` effort=${output.options.reasoningEffort ?? "default"}`
        + ` options=${Object.keys(output.options as Record<string, unknown>).join(",") || "none"}`,
      )
    },
  }
}
