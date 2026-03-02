/**
 * Task Demo — spawns parent + child tasks, shows metadata timeline, ephemeral cleanup.
 *
 * Run: npx tsx src/__demo__/task-demo.ts
 */
import { Store } from '../store.js'
import { ToolboxImpl } from '../toolbox.js'
import { AIInterfaceImpl } from '../ai.js'
import { defineTask, createSpawner } from '../task.js'
import type { TaskMeta } from '../types.js'

// Mock AI so we don't need a real API key
import { vi } from 'vitest'
// We won't actually call AI in this demo, so no mock needed — just construct the instance.

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

function printMeta(label: string, meta: TaskMeta) {
  const statusColor =
    meta.status === 'completed'
      ? GREEN
      : meta.status === 'errored'
        ? RED
        : YELLOW
  console.log(`  ${label}`)
  console.log(`    id:       ${DIM}${meta.id}${RESET}`)
  console.log(`    name:     ${CYAN}${meta.name}${RESET}`)
  console.log(`    status:   ${statusColor}${meta.status}${RESET}`)
  console.log(`    parentId: ${DIM}${meta.parentId ?? '(none)'}${RESET}`)
  console.log(
    `    time:     ${DIM}${meta.startTime} → ${meta.endTime ?? '...'}${RESET}`,
  )
  if (meta.error) {
    console.log(`    error:    ${RED}${meta.error.message}${RESET}`)
  }
}

async function main() {
  const store = new Store()
  const kernel = store.scope('/kernel/')
  const toolbox = new ToolboxImpl(kernel)
  // AI won't be called in this demo, but we need the instance for TaskContext
  const ai = new AIInterfaceImpl(
    { provider: 'anthropic', apiKey: 'demo', defaultModel: 'demo-model' },
    kernel,
  )
  const spawn = createSpawner(store, ai, toolbox)

  // ── Define tasks ──
  const worker = defineTask({
    name: 'worker',
    handler: async (ctx, event: { label: string; shouldFail?: boolean }) => {
      // Write some ephemeral data
      ctx.store.ephemeral.set('scratch', `working on ${event.label}`)
      // Write some persistent local data
      ctx.store.local.set('output', `result of ${event.label}`)
      // Share something globally
      ctx.store.global.set(`workers/${event.label}`, { done: true })

      // Simulate work
      await new Promise((r) => setTimeout(r, 20))

      if (event.shouldFail) {
        throw new Error(`Worker ${event.label} failed intentionally`)
      }

      return { label: event.label, status: 'complete' }
    },
  })

  const coordinator = defineTask({
    name: 'coordinator',
    handler: async (ctx, event: { workers: string[] }) => {
      ctx.store.ephemeral.set('plan', 'coordinating workers')

      // Spawn workers concurrently
      const handles = event.workers.map((label) =>
        ctx.spawn(worker, { label, shouldFail: label === 'C' }),
      )

      // Wait for all
      const results = await Promise.all(handles.map((h) => h.wait()))

      const summary: Record<string, string> = {}
      for (let i = 0; i < event.workers.length; i++) {
        const r = results[i]
        summary[event.workers[i]] = r.ok
          ? `OK: ${r.value.status}`
          : `FAIL: ${r.error.message}`
      }

      return summary
    },
  })

  // ── Run it ──
  header('Spawning coordinator with 3 workers (C will fail)')
  const handle = spawn(coordinator, { workers: ['A', 'B', 'C'] })
  const result = await handle.wait()

  header('Result')
  if (result.ok) {
    for (const [k, v] of Object.entries(result.value)) {
      const color = v.startsWith('OK') ? GREEN : RED
      console.log(`  ${MAGENTA}${k}${RESET}: ${color}${v}${RESET}`)
    }
  }

  // ── Show all task metadata ──
  header('Task metadata')
  const metaKeys = kernel.list('tasks/').filter((k) => k.endsWith('/meta'))
  for (const key of metaKeys) {
    const meta = kernel.get(key.replace('/kernel/', '')) as TaskMeta
    printMeta(`${MAGENTA}${key}${RESET}`, meta)
    console.log()
  }

  // ── Show ephemeral cleanup ──
  header('Ephemeral cleanup verification')
  const raw = store.raw()
  const ephemeralKeys = raw.list('/ephemeral/')
  if (ephemeralKeys.length === 0) {
    console.log(
      `  ${GREEN}All ephemeral keys cleaned up (${ephemeralKeys.length} remaining)${RESET}`,
    )
  } else {
    console.log(
      `  ${RED}Ephemeral keys remaining: ${ephemeralKeys.length}${RESET}`,
    )
    for (const key of ephemeralKeys) {
      console.log(`    ${key}`)
    }
  }

  // ── Show persistent data that survived ──
  header('Persistent data (survived cleanup)')
  const taskKeys = raw.list('/task/')
  for (const key of taskKeys) {
    console.log(`  ${CYAN}${key}${RESET} = ${DIM}${JSON.stringify(raw.get(key))}${RESET}`)
  }

  const globalKeys = raw.list('/global/')
  for (const key of globalKeys) {
    console.log(`  ${CYAN}${key}${RESET} = ${DIM}${JSON.stringify(raw.get(key))}${RESET}`)
  }

  console.log(`\n${BOLD}Done!${RESET}\n`)
}

main().catch(console.error)
