import { strict as assert } from "node:assert"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse } from "jsonc-parser"
import { AiWayAuthPlugin, mapCost, toRuntimeCost } from "../src/plugin.js"

// ── Unit: mapCost ──

function testMapCostToken(): void {
  // Given AI Way token pricing with cache rates
  // When mapCost runs
  // Then rates are copied 1:1 (no /1e6)
  const cost = mapCost({
    currency: "USD",
    billing_mode: "token",
    unit: "per_million_tokens",
    input: 1,
    output: 5,
    cache_read: 0.1,
    cache_write: 1.25,
  })
  assert.deepEqual(cost, {
    input: 1,
    output: 5,
    cache_read: 0.1,
    cache_write: 1.25,
  })
}

function testMapCostMissingAndRequest(): void {
  // Given missing or per-request pricing
  // When mapCost runs
  // Then OpenCode cost is zeroed (no per-request model field)
  assert.deepEqual(mapCost(undefined), { input: 0, output: 0 })
  assert.deepEqual(
    mapCost({
      currency: "USD",
      billing_mode: "request",
      unit: "per_request",
      request: 0.002,
    }),
    { input: 0, output: 0 },
  )
}

function testMapCostTieredGrok(): void {
  // Given grok-4.5 style tiered pricing (200k cutover)
  // When mapCost runs
  // Then base = standard tier and higher tier + context_over_200k = long_context
  const cost = mapCost({
    currency: "USD",
    billing_mode: "tiered",
    unit: "per_million_tokens",
    tiers: [
      {
        name: "standard",
        max_input_tokens: 200000,
        input: 2,
        output: 6,
        cache_read: 0.5,
      },
      {
        name: "long_context",
        min_input_tokens: 200001,
        input: 4,
        output: 12,
        cache_read: 1,
      },
    ],
  })
  assert.equal(cost.input, 2)
  assert.equal(cost.output, 6)
  assert.equal(cost.cache_read, 0.5)
  assert.deepEqual(cost.context_over_200k, {
    input: 4,
    output: 12,
    cache_read: 1,
  })
  assert.ok(cost.tiers)
  assert.equal(cost.tiers?.length, 1)
  assert.deepEqual(cost.tiers?.[0], {
    input: 4,
    output: 12,
    cache_read: 1,
    tier: { type: "context", size: 200000 },
  })
}

function testMapCostTieredGpt55(): void {
  // Given gpt-5.5 style tiered pricing (272k cutover)
  // When mapCost runs
  // Then threshold size is 272000 and context_over_200k is still populated
  const cost = mapCost({
    billing_mode: "tiered",
    tiers: [
      {
        name: "long_context",
        min_input_tokens: 272001,
        input: 10,
        output: 45,
        cache_read: 1,
      },
      {
        name: "standard",
        max_input_tokens: 272000,
        input: 5,
        output: 30,
        cache_read: 0.5,
      },
    ],
  })
  assert.equal(cost.input, 5)
  assert.equal(cost.output, 30)
  assert.equal(cost.tiers?.[0]?.tier.size, 272000)
  assert.deepEqual(cost.context_over_200k, {
    input: 10,
    output: 45,
    cache_read: 1,
  })
}

function testMapCostEmptyTiered(): void {
  assert.deepEqual(mapCost({ billing_mode: "tiered", tiers: [] }), {
    input: 0,
    output: 0,
  })
}

function testToRuntimeCostNestedCache(): void {
  // Given config-shaped cost with flat cache_* fields
  // When toRuntimeCost runs
  // Then runtime getUsage shape has nested cache + experimentalOver200K
  assert.deepEqual(
    toRuntimeCost({
      input: 1,
      output: 5,
      cache_read: 0.1,
      cache_write: 1.25,
    }),
    {
      input: 1,
      output: 5,
      cache: { read: 0.1, write: 1.25 },
    },
  )

  assert.deepEqual(
    toRuntimeCost({
      input: 5,
      output: 30,
      cache_read: 0.5,
      context_over_200k: { input: 10, output: 45, cache_read: 1 },
      tiers: [
        {
          input: 10,
          output: 45,
          cache_read: 1,
          tier: { type: "context", size: 272000 },
        },
      ],
    }),
    {
      input: 5,
      output: 30,
      cache: { read: 0.5, write: 0 },
      experimentalOver200K: {
        input: 10,
        output: 45,
        cache: { read: 1, write: 0 },
      },
      tiers: [
        {
          input: 10,
          output: 45,
          cache: { read: 1, write: 0 },
          tier: { type: "context", size: 272000 },
        },
      ],
    },
  )
}

// ── Integration: written opencode.jsonc cost ──

async function testWrittenConfigCost(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-aiway-auth-pricing-"))
  const configHome = path.join(root, "config")
  const dataHome = path.join(root, "data")
  const configDir = path.join(configHome, "opencode")
  const dataDir = path.join(dataHome, "opencode")
  const jsoncPath = path.join(configDir, "opencode.jsonc")

  const originalConfigHome = process.env.XDG_CONFIG_HOME
  const originalDataHome = process.env.XDG_DATA_HOME
  const originalFetch = globalThis.fetch

  try {
    process.env.XDG_CONFIG_HOME = configHome
    process.env.XDG_DATA_HOME = dataHome
    fs.mkdirSync(configDir, { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(jsoncPath, '{\n  "plugin": ["opencode-aiway-auth@latest"],\n}\n', "utf-8")
    fs.writeFileSync(
      path.join(dataDir, "auth.json"),
      JSON.stringify({ aiway: { type: "api", key: "sk-test" } }, null, 2),
      "utf-8",
    )

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input)
      assert.match(url, /\/v1\/models$/)
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: "claude-haiku-4-5",
              object: "model",
              created: 0,
              native_endpoint_types: ["messages"],
              capabilities: {
                context_window: 200000,
                max_output: 8192,
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              pricing: {
                currency: "USD",
                billing_mode: "token",
                unit: "per_million_tokens",
                input: 1,
                output: 5,
                cache_read: 0.1,
                cache_write: 1.25,
              },
            },
            {
              id: "gpt-5.5",
              object: "model",
              created: 0,
              native_endpoint_types: ["responses"],
              capabilities: {
                context_window: 400000,
                max_output: 128000,
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              pricing: {
                billing_mode: "tiered",
                unit: "per_million_tokens",
                tiers: [
                  {
                    name: "standard",
                    max_input_tokens: 272000,
                    input: 5,
                    output: 30,
                    cache_read: 0.5,
                  },
                  {
                    name: "long_context",
                    min_input_tokens: 272001,
                    input: 10,
                    output: 45,
                    cache_read: 1,
                  },
                ],
              },
            },
            {
              id: "rerank-4-fast",
              object: "model",
              created: 0,
              native_endpoint_types: ["completions"],
              pricing: {
                billing_mode: "request",
                unit: "per_request",
                request: 0.002,
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    const plugin = await AiWayAuthPlugin()
    const auth = plugin.auth
    assert.ok(auth)

    // Mutable provider object mirrors OpenCode's in-memory provider that loader patches.
    const runtimeProvider: Record<string, unknown> = {
      api: "https://aiway.example/v1",
      models: {},
    }
    await auth.loader(async () => ({ key: "sk-test" }), runtimeProvider)

    const runtimeModels = runtimeProvider.models as Record<string, Record<string, unknown>>
    // Given loader patchProvider
    // When inspecting in-memory model cost
    // Then nested cache shape is present so getUsage can bill cache tokens
    assert.deepEqual(runtimeModels["claude-haiku-4-5"].cost, {
      input: 1,
      output: 5,
      cache: { read: 0.1, write: 1.25 },
    })
    assert.deepEqual(runtimeModels["gpt-5.5"].cost, {
      input: 5,
      output: 30,
      cache: { read: 0.5, write: 0 },
      experimentalOver200K: {
        input: 10,
        output: 45,
        cache: { read: 1, write: 0 },
      },
      tiers: [
        {
          input: 10,
          output: 45,
          cache: { read: 1, write: 0 },
          tier: { type: "context", size: 272000 },
        },
      ],
    })
    assert.deepEqual(runtimeModels["rerank-4-fast"].cost, {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    })

    const parsed = parse(fs.readFileSync(jsoncPath, "utf-8"), undefined, {
      allowTrailingComma: true,
      allowEmptyContent: false,
      disallowComments: false,
    }) as Record<string, unknown>
    const providers = parsed.provider as Record<string, unknown>
    const aiway = providers.aiway as Record<string, unknown>
    const models = aiway.models as Record<string, Record<string, unknown>>

    // Given loader wrote models with pricing
    // When reading opencode.jsonc
    // Then cost fields stay config-shaped (flat cache_*)
    assert.deepEqual(models["claude-haiku-4-5"].cost, {
      input: 1,
      output: 5,
      cache_read: 0.1,
      cache_write: 1.25,
    })
    assert.deepEqual(models["gpt-5.5"].cost, {
      input: 5,
      output: 30,
      cache_read: 0.5,
      context_over_200k: { input: 10, output: 45, cache_read: 1 },
      tiers: [
        {
          input: 10,
          output: 45,
          cache_read: 1,
          tier: { type: "context", size: 272000 },
        },
      ],
    })
    assert.deepEqual(models["rerank-4-fast"].cost, { input: 0, output: 0 })
  } finally {
    globalThis.fetch = originalFetch
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalConfigHome
    if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = originalDataHome
    fs.rmSync(root, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  testMapCostToken()
  testMapCostMissingAndRequest()
  testMapCostTieredGrok()
  testMapCostTieredGpt55()
  testMapCostEmptyTiered()
  testToRuntimeCostNestedCache()
  await testWrittenConfigCost()
}

try {
  await main()
  console.log("pricing-map test passed")
} catch (e) {
  console.error(e)
  process.exit(1)
}
