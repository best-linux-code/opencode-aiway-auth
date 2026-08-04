import { strict as assert } from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse } from "jsonc-parser"
import { AiWayAuthPlugin } from "../src/plugin.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-aiway-auth-flat-"))
const configHome = path.join(root, "config")
const dataHome = path.join(root, "data")
const configDir = path.join(configHome, "opencode")
const dataDir = path.join(dataHome, "opencode")
const jsoncPath = path.join(configDir, "opencode.jsonc")

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

function model(
  id: string,
  endpoint: string,
  thinking: "adaptive" | "enabled" | "none" = "none",
): Record<string, unknown> {
  return {
    id,
    object: "model",
    created: 0,
    native_endpoint_types: [endpoint],
    capabilities: {
      effort_levels: ["low", "max"],
      default_effort: "low",
      default_thinking_type: thinking,
      context_window: 128000,
      max_output: 4096,
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
  }
}

function assertNoNestedProviderOptions(
  label: string,
  options: Record<string, unknown>,
): void {
  assert.equal(
    Object.prototype.hasOwnProperty.call(options, "providerOptions"),
    false,
    `${label} must not nest providerOptions (leaks on openai-compatible path)`,
  )
}

async function main(): Promise<void> {
  process.env.XDG_CONFIG_HOME = configHome
  process.env.XDG_DATA_HOME = dataHome

  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(jsoncPath, "{\n  \"plugin\": [\"opencode-aiway-auth@latest\"],\n}\n", "utf-8")
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
        model("kimi-k3", "completions"),
        model("gpt-5.4", "responses"),
        model("claude-sonnet-4-6", "messages", "adaptive"),
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

  const jsonc = parseJsonc(fs.readFileSync(jsoncPath, "utf-8"))
  const providers = jsonc.provider as Record<string, unknown>
  const aiway = providers.aiway as Record<string, unknown>
  const models = aiway.models as Record<string, Record<string, unknown>>

  // Given written model variants for all three protocols
  // When inspecting each effort / thinking variant
  // Then only flat OpenCode options are present (no nested providerOptions)
  const cases: Array<{ id: string; effortKeys: string[] }> = [
    { id: "kimi-k3", effortKeys: ["reasoningEffort"] },
    { id: "gpt-5.4", effortKeys: ["reasoningEffort"] },
    { id: "claude-sonnet-4-6", effortKeys: ["reasoningEffort", "effort"] },
  ]

  for (const { id, effortKeys } of cases) {
    const variants = models[id].variants as Record<string, Record<string, unknown>>
    assert.ok(variants, `${id} has variants`)

    for (const level of ["low", "max"]) {
      const opts = variants[level]
      assert.ok(opts, `${id} variant ${level}`)
      assertNoNestedProviderOptions(`${id}.${level}`, opts)
      for (const key of effortKeys) {
        assert.equal(opts[key], level, `${id}.${level}.${key}`)
      }
    }
  }

  const claudeVariants = models["claude-sonnet-4-6"].variants as Record<string, Record<string, unknown>>
  const thinkingDisabled = claudeVariants["thinking-disabled"]
  assert.ok(thinkingDisabled, "claude has thinking-disabled")
  assertNoNestedProviderOptions("claude.thinking-disabled", thinkingDisabled)
  assert.deepEqual(thinkingDisabled.thinking, { type: "disabled" })

  // Given chat.params with a selected effort variant
  // When the hook runs for each protocol
  // Then output.options stays flat and carries the selected effort
  const chatParams = plugin["chat.params"]
  assert.ok(typeof chatParams === "function", "chat.params hook exists")

  const protocolModels = [
    {
      id: "kimi-k3",
      npm: "@ai-sdk/openai-compatible",
      expect: { reasoningEffort: "max" },
    },
    {
      id: "gpt-5.4",
      npm: "@ai-sdk/openai",
      expect: { reasoningEffort: "max" },
    },
    {
      id: "claude-sonnet-4-6",
      npm: "@ai-sdk/anthropic",
      expect: { reasoningEffort: "max", effort: "max" },
    },
  ] as const

  for (const item of protocolModels) {
    const modelRecord = models[item.id]
    const output = { options: {} as Record<string, unknown> }
    await chatParams(
      {
        provider: { id: "aiway" },
        model: {
          id: item.id,
          api: { npm: item.npm },
          provider: { npm: item.npm },
          variants: modelRecord.variants,
        },
        message: { model: { variant: "max" } },
      },
      output,
    )

    assertNoNestedProviderOptions(`chat.params ${item.id}`, output.options)
    for (const [key, value] of Object.entries(item.expect)) {
      assert.equal(output.options[key], value, `chat.params ${item.id}.${key}`)
    }
  }

  // OpenCode often pre-fills reasoningEffort="low" before chat.params.
  // Selected variant must force-overwrite that default.
  {
    const modelRecord = models["claude-sonnet-4-6"]
    const output = {
      options: {
        reasoningEffort: "low",
        effort: "low",
      } as Record<string, unknown>,
    }
    await chatParams(
      {
        provider: { id: "aiway" },
        model: {
          id: "claude-sonnet-4-6",
          api: { npm: "@ai-sdk/anthropic" },
          provider: { npm: "@ai-sdk/anthropic" },
          variants: modelRecord.variants,
        },
        message: { model: { variant: "max" } },
      },
      output,
    )
    assert.equal(output.options.reasoningEffort, "max", "force overwrite reasoningEffort")
    assert.equal(output.options.effort, "max", "force overwrite effort")
    assertNoNestedProviderOptions("chat.params force-overwrite", output.options)
  }
}

try {
  await main()
  console.log("flat-options test passed")
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
