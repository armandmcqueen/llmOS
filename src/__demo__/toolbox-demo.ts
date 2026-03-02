/**
 * Toolbox Demo — registers tools, executes them, inspects invocation logs.
 *
 * Run: npx tsx src/__demo__/toolbox-demo.ts
 */
import { Store } from '../store.js'
import { ToolboxImpl } from '../toolbox.js'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const MAGENTA = '\x1b[35m'

function header(text: string) {
  console.log(`\n${BOLD}═══ ${text} ═══${RESET}`)
}

async function main() {
  const store = new Store()
  const kernel = store.scope('/kernel/')
  const toolbox = new ToolboxImpl(kernel)

  // ── Register tools ──
  header('Register tools')

  toolbox.register({
    name: 'web_search',
    description: 'Search the web for information',
    schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    execute: async (params: { query: string }) => ({
      results: [`Result 1 for: ${params.query}`, `Result 2 for: ${params.query}`],
    }),
  })
  console.log(`  ${GREEN}Registered:${RESET} web_search`)

  toolbox.register({
    name: 'calculator',
    description: 'Perform arithmetic',
    schema: {
      type: 'object',
      properties: {
        expression: { type: 'string' },
      },
      required: ['expression'],
    },
    execute: async (params: { expression: string }) => ({
      result: Function(`"use strict"; return (${params.expression})`)(),
    }),
  })
  console.log(`  ${GREEN}Registered:${RESET} calculator`)

  toolbox.register({
    name: 'fail_tool',
    description: 'Always fails (for demo)',
    schema: { type: 'object', properties: {} },
    execute: async () => {
      throw new Error('Intentional failure')
    },
  })
  console.log(`  ${GREEN}Registered:${RESET} fail_tool`)

  // ── List tools ──
  header('List tools')
  for (const tool of toolbox.list()) {
    console.log(`  ${CYAN}${tool.name}${RESET} — ${DIM}${tool.description}${RESET}`)
  }

  // ── Execute tools ──
  header('Execute tools')

  const searchResult = await toolbox.execute(
    'web_search',
    { query: 'multi-agent systems' },
    'task-001',
  )
  console.log(`  ${GREEN}web_search result:${RESET}`, searchResult)

  const calcResult = await toolbox.execute(
    'calculator',
    { expression: '2 + 3 * 7' },
    'task-001',
  )
  console.log(`  ${GREEN}calculator result:${RESET}`, calcResult)

  // ── Execute failing tool ──
  header('Execute failing tool')
  try {
    await toolbox.execute('fail_tool', {}, 'task-001')
  } catch (e) {
    console.log(`  ${RED}Caught error:${RESET} ${(e as Error).message}`)
  }

  // ── Execute unknown tool ──
  header('Execute unknown tool')
  try {
    await toolbox.execute('nonexistent', {})
  } catch (e) {
    console.log(`  ${RED}Caught error:${RESET} ${(e as Error).message}`)
  }

  // ── Inspect invocation logs ──
  header('Invocation logs from kernel store')
  const logs = kernel.get('toolbox/invocations') as any[]
  for (const log of logs) {
    const status = log.error
      ? `${RED}ERROR${RESET}: ${log.error}`
      : `${GREEN}OK${RESET}`
    console.log(
      `  ${YELLOW}${log.tool}${RESET}  ${DIM}${log.durationMs}ms${RESET}  taskId=${log.taskId}  ${status}`,
    )
    if (log.result) {
      console.log(`    ${DIM}result: ${JSON.stringify(log.result)}${RESET}`)
    }
  }

  // ── toAITools format ──
  header('toAITools() — AI SDK format')
  const aiTools = toolbox.toAITools(['web_search', 'calculator'])
  for (const [name, tool] of Object.entries(aiTools)) {
    const t = tool as any
    console.log(`  ${MAGENTA}${name}${RESET}`)
    console.log(`    has parameters: ${!!t.parameters}`)
    console.log(`    has execute: ${typeof t.execute === 'function'}`)
  }

  console.log(`\n${BOLD}Done!${RESET}\n`)
}

main().catch(console.error)
