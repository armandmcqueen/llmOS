/**
 * AI Interface Demo — makes a mocked AI call, inspects logs and usage.
 *
 * Run: npx tsx src/__demo__/ai-demo.ts
 *
 * This uses a mock — no API key needed.
 */
import { Store } from '../store.js'
import { AIInterfaceImpl } from '../ai.js'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const MAGENTA = '\x1b[35m'

function header(text: string) {
  console.log(`\n${BOLD}═══ ${text} ═══${RESET}`)
}

/**
 * We can't easily mock generateText in a demo script, so instead we'll
 * create a subclass that overrides request() to simulate the full flow
 * (logging, usage tracking) without calling the real SDK.
 */
class MockAIInterface extends AIInterfaceImpl {
  private responses: Array<{ text: string; promptTokens: number; completionTokens: number }>;
  private callIndex = 0;

  constructor(
    config: Parameters<typeof AIInterfaceImpl['prototype']['forTask']> extends never ? never : any,
    kernelStore: any,
    taskId?: string,
    responses?: Array<{ text: string; promptTokens: number; completionTokens: number }>,
  ) {
    super(config, kernelStore, taskId)
    this.responses = responses ?? [
      { text: 'Multi-agent systems involve multiple AI agents working together...', promptTokens: 150, completionTokens: 500 },
      { text: 'Based on my research, the key findings are...', promptTokens: 300, completionTokens: 800 },
    ]
  }

  override forTask(taskId: string): MockAIInterface {
    return new MockAIInterface(
      (this as any).config,
      (this as any).kernelStore,
      taskId,
      this.responses,
    )
  }

  override async request(params: Parameters<AIInterfaceImpl['request']>[0]) {
    const mock = this.responses[this.callIndex % this.responses.length]
    this.callIndex++

    // Simulate what the real implementation does: log and track usage
    const model = params.model ?? (this as any).config.defaultModel
    const kernelStore = (this as any).kernelStore
    const taskId = (this as any).taskId

    const response = {
      content: mock.text,
      toolCalls: [],
      usage: {
        promptTokens: mock.promptTokens,
        completionTokens: mock.completionTokens,
        totalTokens: mock.promptTokens + mock.completionTokens,
      },
      raw: { mocked: true },
    }

    kernelStore.append('ai/requests', {
      model,
      request: {
        system: params.system,
        messages: params.messages,
        tools: params.tools?.map((t: any) => t.name) ?? [],
      },
      response: {
        content: response.content,
        toolCalls: response.toolCalls,
        usage: response.usage,
      },
      durationMs: Math.floor(Math.random() * 3000) + 500,
      timestamp: new Date().toISOString(),
      taskId,
    })

    if (taskId) {
      const usageKey = `tasks/${taskId}/usage`
      const current = kernelStore.get(usageKey) ?? {
        promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0,
      }
      kernelStore.set(usageKey, {
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
  const store = new Store()
  const kernel = store.scope('/kernel/')
  const ai = new MockAIInterface(
    { provider: 'anthropic', apiKey: 'mock', defaultModel: 'claude-sonnet-4-20250514' },
    kernel,
  )

  // ── Make requests from two different tasks ──
  header('Making AI requests (mocked)')

  const task1Ai = ai.forTask('task-001')
  const resp1 = await task1Ai.request({
    system: 'You are a research assistant.',
    messages: [{ role: 'user', content: 'Research multi-agent systems' }],
  })
  console.log(`  ${GREEN}Task 1, Request 1:${RESET}`)
  console.log(`    content: ${DIM}${resp1.content.slice(0, 60)}...${RESET}`)
  console.log(`    usage: ${CYAN}${resp1.usage.promptTokens}p + ${resp1.usage.completionTokens}c = ${resp1.usage.totalTokens} total${RESET}`)

  const resp2 = await task1Ai.request({
    system: 'You are a research assistant.',
    messages: [
      { role: 'user', content: 'Research multi-agent systems' },
      { role: 'assistant', content: resp1.content },
      { role: 'user', content: 'Summarize findings' },
    ],
  })
  console.log(`\n  ${GREEN}Task 1, Request 2:${RESET}`)
  console.log(`    content: ${DIM}${resp2.content.slice(0, 60)}...${RESET}`)
  console.log(`    usage: ${CYAN}${resp2.usage.promptTokens}p + ${resp2.usage.completionTokens}c = ${resp2.usage.totalTokens} total${RESET}`)

  const task2Ai = ai.forTask('task-002')
  const resp3 = await task2Ai.request({
    messages: [{ role: 'user', content: 'Analyze context engineering' }],
  })
  console.log(`\n  ${GREEN}Task 2, Request 1:${RESET}`)
  console.log(`    content: ${DIM}${resp3.content.slice(0, 60)}...${RESET}`)

  // ── Inspect request logs ──
  header('AI request logs (from /kernel/ai/requests)')
  const logs = kernel.get('ai/requests') as any[]
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i]
    console.log(`  ${YELLOW}[${i}]${RESET} model=${log.model}  taskId=${log.taskId}  ${DIM}${log.durationMs}ms${RESET}`)
    console.log(`      system: ${DIM}${log.request.system ?? '(none)'}${RESET}`)
    console.log(`      messages: ${DIM}${log.request.messages.length} message(s)${RESET}`)
    console.log(`      usage: ${CYAN}${log.response.usage.totalTokens} tokens${RESET}`)
  }

  // ── Inspect cumulative usage ──
  header('Cumulative usage per task (from /kernel/tasks/{id}/usage)')
  const usage1 = kernel.get('tasks/task-001/usage')
  console.log(`  ${MAGENTA}task-001:${RESET}`)
  console.log(`    promptTokens: ${usage1.promptTokens}`)
  console.log(`    completionTokens: ${usage1.completionTokens}`)
  console.log(`    totalTokens: ${usage1.totalTokens}`)
  console.log(`    requestCount: ${usage1.requestCount}`)

  const usage2 = kernel.get('tasks/task-002/usage')
  console.log(`  ${MAGENTA}task-002:${RESET}`)
  console.log(`    promptTokens: ${usage2.promptTokens}`)
  console.log(`    completionTokens: ${usage2.completionTokens}`)
  console.log(`    totalTokens: ${usage2.totalTokens}`)
  console.log(`    requestCount: ${usage2.requestCount}`)

  console.log(`\n${BOLD}Done!${RESET}\n`)
}

main().catch(console.error)
