/**
 * Store Demo — shows how scoped accessors resolve keys to full paths.
 *
 * Run: npx tsx src/__demo__/store-demo.ts
 */
import { Store } from '../store.js'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const MAGENTA = '\x1b[35m'
const RED = '\x1b[31m'

function header(text: string) {
  console.log(`\n${BOLD}═══ ${text} ═══${RESET}`)
}

function op(color: string, label: string, key: string, fullPath: string, value?: any) {
  const valStr = value !== undefined ? ` → ${JSON.stringify(value)}` : ''
  console.log(
    `  ${color}${label}${RESET} key=${DIM}"${key}"${RESET}  full_path=${BOLD}"${fullPath}"${RESET}${valStr}`,
  )
}

const store = new Store()

// ── Create accessors for a task ──
const taskId = 'abc-123'
const local = store.scope(`/task/${taskId}/`)
const ephemeral = store.scope(`/ephemeral/tasks/${taskId}/`)
const global = store.scope('/global/')
const kernel = store.scope('/kernel/')
const raw = store.raw()

header('SET operations — each accessor auto-prefixes')

op(GREEN, 'local.set', 'findings', `/task/${taskId}/findings`, { topic: 'agents' })
local.set('findings', { topic: 'agents' })

op(YELLOW, 'ephemeral.set', 'scratch', `/ephemeral/tasks/${taskId}/scratch`, 'temp data')
ephemeral.set('scratch', 'temp data')

op(CYAN, 'global.set', 'shared/plan', '/global/shared/plan', 'the plan')
global.set('shared/plan', 'the plan')

op(MAGENTA, 'kernel.set', 'tasks/abc-123/meta', '/kernel/tasks/abc-123/meta', { status: 'running' })
kernel.set('tasks/abc-123/meta', { status: 'running' })

op(RED, 'raw.set', '/custom/path', '/custom/path', 42)
raw.set('/custom/path', 42)

header('GET operations — each accessor reads through its prefix')

console.log(`  ${GREEN}local.get("findings")${RESET} →`, local.get('findings'))
console.log(`  ${YELLOW}ephemeral.get("scratch")${RESET} →`, ephemeral.get('scratch'))
console.log(`  ${CYAN}global.get("shared/plan")${RESET} →`, global.get('shared/plan'))
console.log(`  ${RED}raw.get("/global/shared/plan")${RESET} →`, raw.get('/global/shared/plan'))

header('LIST — shows full resolved paths')

console.log(`  ${DIM}All keys in store:${RESET}`)
for (const key of raw.list()) {
  console.log(`    ${key}`)
}

console.log(`\n  ${GREEN}local.list()${RESET} — keys under /task/${taskId}/:`)
for (const key of local.list()) {
  console.log(`    ${key}`)
}

header('APPEND — creates or extends arrays')

kernel.append('ai/requests', { id: 1, model: 'claude' })
kernel.append('ai/requests', { id: 2, model: 'gpt' })
console.log(`  ${MAGENTA}kernel.get("ai/requests")${RESET} →`, kernel.get('ai/requests'))

header('APPEND error — throws on non-array')

raw.set('/scalar', 'hello')
try {
  raw.append('/scalar', 'nope')
} catch (e) {
  console.log(`  ${RED}Expected error:${RESET} ${(e as Error).message}`)
}

header('DELETE')

console.log(`  ${YELLOW}ephemeral.delete("scratch")${RESET} →`, ephemeral.delete('scratch'))
console.log(`  ${YELLOW}ephemeral.get("scratch")${RESET} →`, ephemeral.get('scratch'))

header('Prefix isolation')

const task2 = store.scope('/task/xyz-789/')
task2.set('findings', { topic: 'different' })
console.log(`  ${GREEN}task abc-123 findings:${RESET}`, local.get('findings'))
console.log(`  ${GREEN}task xyz-789 findings:${RESET}`, task2.get('findings'))

console.log(`\n${BOLD}Done!${RESET}\n`)
