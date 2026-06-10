import { strict as assert } from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse } from "jsonc-parser"
import { AiWayAuthPlugin } from "../src/plugin.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-aiway-auth-jsonc-"))
const configHome = path.join(root, "config")
const dataHome = path.join(root, "data")
const configDir = path.join(configHome, "opencode")
const dataDir = path.join(dataHome, "opencode")
const jsoncPath = path.join(configDir, "opencode.jsonc")
const jsonPath = path.join(configDir, "opencode.json")

const originalConfigHome = process.env.XDG_CONFIG_HOME
const originalDataHome = process.env.XDG_DATA_HOME
const originalFetch = globalThis.fetch

function parseJsonc(text: string): Record<string, unknown> {
  const parsed = parse(text, undefined, {
    allowTrailingComma: true,
    allowEmptyContent: false,
    disallowComments: false,
  })
  assert.equal(typeof parsed, "object")
  assert.notEqual(parsed, null)
  assert.equal(Array.isArray(parsed), false)
  return parsed as Record<string, unknown>
}

function model(id: string, endpoint: string): Record<string, unknown> {
  return {
    id,
    object: "model",
    created: 0,
    native_endpoint_types: [endpoint],
    capabilities: {
      effort_levels: ["low", "high"],
      default_effort: "low",
      default_thinking_type: endpoint === "messages" ? "adaptive" : "none",
      context_window: 128000,
      max_output: 4096,
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
  }
}

async function main(): Promise<void> {
  process.env.XDG_CONFIG_HOME = configHome
  process.env.XDG_DATA_HOME = dataHome

  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })

  fs.writeFileSync(
    jsoncPath,
    `{
  // keep plugin comment
  "plugin": [
    "opencode-aiway-auth@latest",
  ],
}
`,
    "utf-8",
  )
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      plugin: ["legacy-plugin"],
      provider: {
        aiway: {
          id: "aiway",
          name: "old aiway",
          models: {
            "old-model": {},
          },
        },
        other: {
          id: "other",
        },
      },
    }, null, 2),
    "utf-8",
  )
  fs.writeFileSync(
    path.join(dataDir, "auth.json"),
    JSON.stringify({ aiway: { type: "api", key: "sk-test" } }, null, 2),
    "utf-8",
  )

  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input)
    assert.match(url, /\/v1\/models$/)
    return new Response(JSON.stringify({
      object: "list",
      data: [
        model("gpt-5.4", "responses"),
        model("claude-sonnet-4-6", "messages"),
        model("qwen3-coder", "messages"),
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  const plugin = await AiWayAuthPlugin()
  const auth = plugin.auth
  assert.ok(auth)
  await auth.loader(async () => ({ key: "sk-test" }), { api: "https://aiway.example/v1" })

  const jsoncText = fs.readFileSync(jsoncPath, "utf-8")
  assert.match(jsoncText, /keep plugin comment/)
  assert.match(jsoncText, /"opencode-aiway-auth@latest",/)

  const jsonc = parseJsonc(jsoncText)
  assert.deepEqual(jsonc.plugin, ["opencode-aiway-auth@latest"])
  const providers = jsonc.provider as Record<string, unknown>
  const aiway = providers.aiway as Record<string, unknown>
  assert.equal(aiway.api, "https://aiway.example/v1")
  const models = aiway.models as Record<string, Record<string, unknown>>
  assert.equal((models["gpt-5.4"].provider as Record<string, unknown>).npm, "@ai-sdk/openai")
  assert.equal((models["claude-sonnet-4-6"].provider as Record<string, unknown>).npm, "@ai-sdk/anthropic")
  assert.equal((models["qwen3-coder"].provider as Record<string, unknown>).npm, "@ai-sdk/anthropic")

  const legacy = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<string, unknown>
  assert.deepEqual(legacy.plugin, ["legacy-plugin"])
  assert.deepEqual(legacy.provider, { other: { id: "other" } })
}

try {
  await main()
  console.log("JSONC config test passed")
} finally {
  globalThis.fetch = originalFetch
  if (originalConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME
  } else {
    process.env.XDG_CONFIG_HOME = originalConfigHome
  }
  if (originalDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
  } else {
    process.env.XDG_DATA_HOME = originalDataHome
  }
  fs.rmSync(root, { recursive: true, force: true })
}
