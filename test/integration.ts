/**
 * Integration tests for opencode-aiway-auth against live AI Way server.
 *
 * Usage: npx tsx test/integration.ts
 */

const BASE_URL = process.env.AIWAY_BASE_URL || "http://192.168.77.88"
const API_KEY = process.env.AIWAY_API_KEY || ""

if (!API_KEY) {
  console.error("Set AIWAY_API_KEY env variable to run integration tests")
  process.exit(1)
}

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓ ${msg}`)
    passed++
  } else {
    console.error(`  ✗ ${msg}`)
    failed++
  }
}

interface ModelCapabilities {
  effort_levels?: string[]
  default_effort?: string
  default_thinking_type?: string
  input_modalities?: string[]
  output_modalities?: string[]
}

interface Model {
  id: string
  object: string
  capabilities?: ModelCapabilities
}

interface ModelsResponse {
  object: string
  data: Model[]
  success?: boolean
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

// ── T-1: Connectivity ──

async function testConnectivity(): Promise<void> {
  console.log("\nT-1: Connectivity")
  const data = await fetchJSON<ModelsResponse>(`${BASE_URL}/v1/models`)
  assert(Array.isArray(data.data), "response has data array")
  assert(data.data.length > 0, `returned ${data.data.length} models`)
}

// ── T-2: Model Discovery ──

async function testModelDiscovery(): Promise<Model[]> {
  console.log("\nT-2: Model Discovery")
  const data = await fetchJSON<ModelsResponse>(`${BASE_URL}/v1/models`)
  const models = data.data

  for (const m of models) {
    assert(typeof m.id === "string" && m.id.length > 0, `model ${m.id} has id`)
    assert(m.capabilities !== undefined, `model ${m.id} has capabilities`)
    assert(
      Array.isArray(m.capabilities?.input_modalities),
      `model ${m.id} has input_modalities`,
    )
    assert(
      typeof m.capabilities?.default_thinking_type === "string",
      `model ${m.id} has default_thinking_type`,
    )
  }

  return models
}

// ── T-3: Capability Mapping Sanity ──

function testCapabilityMapping(models: Model[]): void {
  console.log("\nT-3: Capability Mapping")

  const withEffort = models.filter((m) => m.capabilities?.effort_levels?.length)
  assert(withEffort.length > 0, `${withEffort.length} models have effort_levels`)

  const withImage = models.filter((m) => m.capabilities?.input_modalities?.includes("image"))
  assert(withImage.length > 0, `${withImage.length} models support image input`)

  const withPdf = models.filter((m) => m.capabilities?.input_modalities?.includes("pdf"))
  assert(withPdf.length > 0, `${withPdf.length} models support pdf input`)

  const adaptive = models.filter((m) => m.capabilities?.default_thinking_type === "adaptive")
  assert(adaptive.length > 0, `${adaptive.length} models have adaptive thinking`)

  const enabled = models.filter((m) => m.capabilities?.default_thinking_type === "enabled")
  assert(enabled.length > 0, `${enabled.length} models have enabled thinking`)
}

// ── T-4: Invalid Key ──

async function testInvalidKey(): Promise<void> {
  console.log("\nT-4: Invalid Key")
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      headers: { Authorization: "Bearer sk-invalid" },
      signal: AbortSignal.timeout(10000),
    })
    assert(res.status === 401 || res.status === 403, `invalid key returns ${res.status}`)
  } catch (e) {
    assert(false, `request failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ── T-5: Chat Completion ──

async function testChatCompletion(models: Model[]): Promise<void> {
  console.log("\nT-5: Chat Completion (non-stream)")
  const model = models.find((m) => m.id.includes("haiku") || m.id.includes("mini")) ?? models[0]
  if (!model) {
    assert(false, "no model available for chat test")
    return
  }

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: "user", content: "Say hello in exactly 3 words." }],
      stream: false,
      max_tokens: 64,
    }),
    signal: AbortSignal.timeout(30000),
  })

  assert(res.ok, `chat response status ${res.status}`)
  const body = (await res.json()) as Record<string, unknown>
  const choices = body.choices as Array<Record<string, unknown>> | undefined
  assert(Array.isArray(choices) && choices.length > 0, "response has choices")
  console.log(`  → model=${model.id}, reply=${JSON.stringify((choices?.[0]?.message as Record<string, unknown>)?.content ?? "").slice(0, 100)}`)
}

// ── Run All ──

async function main(): Promise<void> {
  console.log(`\nAI Way Integration Tests`)
  console.log(`Target: ${BASE_URL}\n`)

  try {
    await testConnectivity()
    const models = await testModelDiscovery()
    testCapabilityMapping(models)
    await testInvalidKey()
    await testChatCompletion(models)
  } catch (e) {
    console.error(`\nFATAL: ${e instanceof Error ? e.message : String(e)}`)
    failed++
  }

  console.log(`\n${"─".repeat(40)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
