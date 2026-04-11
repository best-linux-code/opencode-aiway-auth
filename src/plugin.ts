import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

// ── Constants ──

const PROVIDER_ID = "aiway"
const PROVIDER_NAME = "AI Way"
const DEFAULT_BASE_URL = "http://192.168.77.88"
const LOG_FILE = "/tmp/opencode-aiway-auth.log"

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

interface AiWayModel {
  id: string
  object: string
  created: number
  supported_endpoint_types?: string[]
  capabilities?: AiWayCapabilities
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

function configPath(): string {
  return path.join(configDir(), "opencode.json")
}

function readConfig(): Record<string, unknown> {
  try {
    if (!fs.existsSync(configPath())) return {}
    return JSON.parse(fs.readFileSync(configPath(), "utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeConfig(cfg: Record<string, unknown>): void {
  const dir = configDir()
  const target = configPath()
  const tmp = path.join(dir, `opencode.json.tmp-${process.pid}-${Date.now().toString(36)}`)
  fs.mkdirSync(dir, { recursive: true })
  try {
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf-8")
    fs.renameSync(tmp, target)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch {}
    throw err
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

function hasModality(caps: AiWayCapabilities | undefined, mod: string): boolean {
  return caps?.input_modalities?.includes(mod) ?? false
}

function supportsReasoning(caps: AiWayCapabilities | undefined): boolean {
  if (!caps) return false
  if (caps.effort_levels && caps.effort_levels.length > 0) return true
  return caps.default_thinking_type !== undefined && caps.default_thinking_type !== "none"
}

function buildVariants(caps: AiWayCapabilities | undefined): Record<string, Record<string, unknown>> | undefined {
  if (!caps) return undefined
  const variants: Record<string, Record<string, unknown>> = {}

  if (caps.effort_levels) {
    for (const level of caps.effort_levels) {
      variants[level] = { reasoning_effort: level }
    }
  }

  if (caps.default_thinking_type === "adaptive" || caps.default_thinking_type === "enabled") {
    variants["thinking-disabled"] = { thinking: { type: "disabled" } }
  }

  return Object.keys(variants).length > 0 ? variants : undefined
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
  const variants = buildVariants(caps)

  return {
    id: m.id,
    providerID: PROVIDER_ID,
    name: m.id,
    attachment,
    modalities: {
      input: caps?.input_modalities ?? ["text"],
      output: caps?.output_modalities ?? ["text"],
    },
    api: {
      id: m.id,
      url: `${base}/v1`,
      npm: "@ai-sdk/openai-compatible",
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
    cost: { input: 0, output: 0 },
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
  const cfg = readConfig()
  const providers = (cfg.provider as Record<string, unknown>) ?? {}
  const current = (providers[PROVIDER_ID] as Record<string, unknown>) ?? {}
  const modelsRecord: Record<string, Record<string, unknown>> = {}

  for (const m of models) {
    modelsRecord[m.id] = mapModel(m, base)
  }

  providers[PROVIDER_ID] = {
    ...current,
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    api: `${base}/v1`,
    npm: "@ai-sdk/openai-compatible",
    env: [],
    models: modelsRecord,
  }
  cfg.provider = providers
  writeConfig(cfg)
  log(`Wrote provider config: ${Object.keys(modelsRecord).length} models`)
}

function removeProviderConfig(): void {
  const cfg = readConfig()
  const providers = cfg.provider as Record<string, unknown> | undefined
  if (!providers?.[PROVIDER_ID]) return
  delete providers[PROVIDER_ID]
  if (Object.keys(providers).length === 0) delete cfg.provider
  writeConfig(cfg)
  log("Removed provider config")
}

function ensureProviderConfig(): void {
  const cfg = readConfig()
  const providers = (cfg.provider as Record<string, unknown>) ?? {}
  if (providers[PROVIDER_ID]) return
  providers[PROVIDER_ID] = {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    api: `${DEFAULT_BASE_URL}/v1`,
    npm: "@ai-sdk/openai-compatible",
    env: [],
    models: {},
  }
  cfg.provider = providers
  writeConfig(cfg)
  log("Bootstrap: wrote minimal provider config")
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
          log(`  ${m.id}: thinking=${caps?.default_thinking_type ?? "unknown"}${efforts ? `, effort=[${efforts}]` : ""}, input=[${caps?.input_modalities?.join(",") ?? "text"}]`)
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

      const effort = typeof output.options.reasoning_effort === "string"
        ? output.options.reasoning_effort
        : "default"

      log(`[request] model=${input.model.id} effort=${effort}`)
    },
  }
}
