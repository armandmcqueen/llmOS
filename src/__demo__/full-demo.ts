/**
 * Full Demo — runs the coordinator/researcher pattern from DESIGN.md
 * with a mock AI provider, then prints a formatted summary of all system state.
 *
 * Run: npx tsx src/__demo__/full-demo.ts
 */
import { createLLMOS } from '../index.js'
import type { TaskMeta } from '../types.js'

// We need to mock generateText before it's imported by ai.ts
// Since we can't easily mock in a demo script, we'll subclass/monkey-patch.
// Instead, let's use the real createLLMOS but override the AI at the task level.

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const MAGENTA = '\x1b[35m'
const RED = '\x1b[31m'
const BLUE = '\x1b[34m'

function header(text: string) {
  console.log(`\n${BOLD}${'═'.repeat(60)}${RESET}`)
  console.log(`${BOLD}  ${text}${RESET}`)
  console.log(`${BOLD}${'═'.repeat(60)}${RESET}`)
}

function subheader(text: string) {
  console.log(`\n  ${BOLD}── ${text} ──${RESET}`)
}

/**
 * Since we can't easily mock the AI SDK's generateText in a demo script,
 * we'll build the system manually using the lower-level pieces and a mock AI.
 */
import { Store } from '../store.js'
import { ToolboxImpl } from '../toolbox.js'
import { AIInterfaceImpl } from '../ai.js'
import { defineTask, createSpawner } from '../task.js'
import type { AIRequestParams, AIResponse, AIInterface } from '../types.js'

/** Mock AI that returns canned responses based on the topic. */
class MockAI implements AIInterface {
  private kernelStore: ReturnType<Store['scope']>
  private taskId: string | null

  constructor(kernelStore: ReturnType<Store['scope']>, taskId?: string) {
    this.kernelStore = kernelStore
    this.taskId = taskId ?? null
  }

  forTask(taskId: string): MockAI {
    return new MockAI(this.kernelStore, taskId)
  }

  async request(params: AIRequestParams): Promise<AIResponse> {
    // Simulate latency
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 30))

    const userMsg = params.messages.find((m) => m.role === 'user')?.content ?? ''
    const content = `Research findings on "${userMsg.slice(0, 50)}": This is a simulated response with key insights about the topic.`

    const response: AIResponse = {
      content,
      toolCalls: [],
      usage: {
        promptTokens: 100 + Math.floor(Math.random() * 200),
        completionTokens: 200 + Math.floor(Math.random() * 300),
        totalTokens: 0,
      },
      raw: { mocked: true },
    }
    response.usage.totalTokens = response.usage.promptTokens + response.usage.completionTokens

    // Log to kernel store (mirroring what AIInterfaceImpl does)
    this.kernelStore.append('ai/requests', {
      model: params.model ?? 'mock-model',
      request: {
        system: params.system,
        messages: params.messages,
        tools: params.tools?.map((t) => t.name) ?? [],
      },
      response: {
        content: response.content,
        toolCalls: response.toolCalls,
        usage: response.usage,
      },
      durationMs: Math.floor(Math.random() * 2000) + 500,
      timestamp: new Date().toISOString(),
      taskId: this.taskId,
    })

    if (this.taskId) {
      const usageKey = `tasks/${this.taskId}/usage`
      const current = this.kernelStore.get(usageKey) ?? {
        promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0,
      }
      this.kernelStore.set(usageKey, {
        promptTokens: current.promptTokens + response.usage.promptTokens,
        completionTokens: current.completionTokens + response.usage.completionTokens,
        totalTokens: current.totalTokens + response.usage.totalTokens,
        requestCount: current.requestCount + 1,
      })
    }

    return response
  }
}

async function main() {
  // ── Build the system ──
  const store = new Store()
  const kernelStore = store.scope('/kernel/')
  const toolbox = new ToolboxImpl(kernelStore)
  const mockAi = new MockAI(kernelStore)

  // createSpawner expects an AIInterfaceImpl but our mock has the same shape
  // We'll cast it — the task system only uses forTask() and request()
  const spawn = createSpawner(store, mockAi as any, toolbox)

  header('llm-os v0.1 — Full Demo')
  console.log(`\n  Running the coordinator/researcher pattern from DESIGN.md`)
  console.log(`  with a mock AI provider (no API key needed).`)

  // ── Register tools ──
  subheader('Registering tools')
  toolbox.register({
    name: 'web_search',
    description: 'Search the web for information',
    schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
    execute: async (params: { query: string }) => ({
      results: [`Result for: ${params.query}`],
    }),
  })
  console.log(`  ${GREEN}registered:${RESET} web_search`)

  // ── Define tasks ──
  subheader('Defining tasks')

  const researcher = defineTask({
    name: 'researcher',
    handler: async (ctx, event: { topic: string }) => {
      // Use ephemeral storage for scratch work
      ctx.store.ephemeral.set('status', 'researching')

      // Make an LLM call
      const response = await ctx.ai.request({
        system: 'You are a research assistant. Be concise.',
        messages: [
          { role: 'user', content: `Research the following topic: ${event.topic}` },
        ],
      })

      // Store findings
      ctx.store.local.set('findings', response.content)
      ctx.store.global.set(`research/${event.topic}`, {
        summary: response.content,
        tokens: response.usage.totalTokens,
      })

      return { findings: response.content, usage: response.usage }
    },
  })
  console.log(`  ${GREEN}defined:${RESET} researcher`)

  const coordinator = defineTask({
    name: 'coordinator',
    handler: async (ctx, event: { topics: string[] }) => {
      ctx.store.ephemeral.set('plan', `Research ${event.topics.length} topics`)

      // Spawn researchers concurrently
      const handles = event.topics.map((topic) =>
        ctx.spawn(researcher, { topic }),
      )

      // Wait for all
      const results = await Promise.all(handles.map((h) => h.wait()))

      const findings: Record<string, string> = {}
      for (let i = 0; i < event.topics.length; i++) {
        const result = results[i]
        if (result.ok) {
          findings[event.topics[i]] = result.value.findings
        } else {
          findings[event.topics[i]] = `ERROR: ${result.error.message}`
        }
      }

      return { findings }
    },
  })
  console.log(`  ${GREEN}defined:${RESET} coordinator`)

  // ── Run it ──
  subheader('Spawning coordinator')
  const topics = ['multi-agent systems', 'context engineering', 'sleep-time compute']
  console.log(`  topics: ${topics.map((t) => `${CYAN}${t}${RESET}`).join(', ')}`)

  const handle = spawn(coordinator, { topics })
  const result = await handle.wait()

  // ── Print result ──
  header('Result')
  if (result.ok) {
    for (const [topic, findings] of Object.entries(result.value.findings)) {
      console.log(`\n  ${MAGENTA}${topic}${RESET}`)
      console.log(`    ${DIM}${(findings as string).slice(0, 80)}...${RESET}`)
    }
  } else {
    console.log(`  ${RED}Coordinator failed: ${result.error.message}${RESET}`)
  }

  // ── Print all task metadata ──
  header('Task Metadata')
  const metaKeys = kernelStore.list('tasks/').filter((k) => k.endsWith('/meta'))
  for (const key of metaKeys) {
    const meta = kernelStore.get(key.replace('/kernel/', '')) as TaskMeta
    const statusColor = meta.status === 'completed' ? GREEN : meta.status === 'errored' ? RED : YELLOW
    const duration = meta.endTime && meta.startTime
      ? `${new Date(meta.endTime).getTime() - new Date(meta.startTime).getTime()}ms`
      : '...'

    console.log(
      `  ${statusColor}●${RESET} ${CYAN}${meta.name}${RESET}  ` +
      `id=${DIM}${meta.id.slice(0, 8)}...${RESET}  ` +
      `parent=${DIM}${meta.parentId?.slice(0, 8) ?? 'none'}...${RESET}  ` +
      `${DIM}${duration}${RESET}`
    )
  }

  // ── Print AI request log ──
  header('AI Request Log')
  const aiRequests = kernelStore.get('ai/requests') as any[]
  console.log(`  ${YELLOW}Total requests: ${aiRequests?.length ?? 0}${RESET}`)
  if (aiRequests) {
    let totalPrompt = 0, totalCompletion = 0
    for (const req of aiRequests) {
      totalPrompt += req.response.usage.promptTokens
      totalCompletion += req.response.usage.completionTokens
      console.log(
        `  ${DIM}→${RESET} model=${req.model}  task=${req.taskId?.slice(0, 8)}...  ` +
        `${CYAN}${req.response.usage.totalTokens} tokens${RESET}  ${DIM}${req.durationMs}ms${RESET}`
      )
    }
    console.log(`  ${BOLD}Total: ${totalPrompt}p + ${totalCompletion}c = ${totalPrompt + totalCompletion} tokens${RESET}`)
  }

  // ── Print per-task usage ──
  header('Per-Task AI Usage')
  const usageKeys = kernelStore.list('tasks/').filter((k) => k.endsWith('/usage'))
  for (const key of usageKeys) {
    const usage = kernelStore.get(key.replace('/kernel/', ''))
    const taskId = key.split('/')[3] // /kernel/tasks/{id}/usage
    const meta = kernelStore.get(`tasks/${taskId}/meta`) as TaskMeta | undefined
    console.log(
      `  ${MAGENTA}${meta?.name ?? 'unknown'}${RESET} (${DIM}${taskId.slice(0, 8)}...${RESET}): ` +
      `${usage.requestCount} req, ${CYAN}${usage.totalTokens} tokens${RESET}`
    )
  }

  // ── Print global store ──
  header('Global Store')
  const raw = store.raw()
  const globalKeys = raw.list('/global/')
  for (const key of globalKeys) {
    const val = raw.get(key)
    console.log(`  ${BLUE}${key}${RESET}`)
    console.log(`    ${DIM}${JSON.stringify(val).slice(0, 100)}${RESET}`)
  }

  // ── Verify ephemeral cleanup ──
  header('Ephemeral Cleanup')
  const ephemeralKeys = raw.list('/ephemeral/')
  console.log(
    ephemeralKeys.length === 0
      ? `  ${GREEN}All ephemeral data cleaned up (0 keys remaining)${RESET}`
      : `  ${RED}${ephemeralKeys.length} ephemeral keys remaining!${RESET}`
  )

  // ── Summary stats ──
  header('Summary')
  const allMetas = metaKeys.map(
    (k) => kernelStore.get(k.replace('/kernel/', '')) as TaskMeta,
  )
  console.log(`  Tasks spawned:    ${allMetas.length}`)
  console.log(`  Tasks completed:  ${allMetas.filter((m) => m.status === 'completed').length}`)
  console.log(`  Tasks errored:    ${allMetas.filter((m) => m.status === 'errored').length}`)
  console.log(`  AI requests:      ${aiRequests?.length ?? 0}`)
  console.log(`  Tool invocations: ${kernelStore.get('toolbox/invocations')?.length ?? 0}`)
  console.log(`  Global keys:      ${globalKeys.length}`)
  console.log(`  Ephemeral keys:   ${ephemeralKeys.length}`)

  console.log(`\n${BOLD}Done!${RESET}\n`)
}

main().catch(console.error)
