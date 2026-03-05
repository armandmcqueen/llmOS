#!/usr/bin/env node
/**
 * Interactive CLI for the chat-with-history demo.
 *
 * Usage:
 *   pnpm cli                    # mock mode (no API calls)
 *   pnpm cli --real              # real Haiku mode (needs ANTHROPIC_API_KEY)
 *   pnpm cli --delay 500         # mock mode with 500ms delay per AI call
 *   pnpm cli --load snapshot.json  # load previous session state
 */

import * as readline from 'node:readline'
import { writeFile, readFile } from 'node:fs/promises'
import { v4 as uuidv4 } from 'uuid'
import type { TaskMeta } from 'llmos-v0'
import { createChatLLMOS } from './setup.js'
import { chatTurnTask } from './chat.js'
import type { ConversationMessage, StoredRequest, StoredResponse } from './types.js'

// ─── Parse CLI Args ─────────────────────────────────────────────────

interface CLIOptions {
  mode: 'mock' | 'real'
  delayMs: number
  loadFile?: string
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2)
  const opts: CLIOptions = { mode: 'mock', delayMs: 0 }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--real':
        opts.mode = 'real'
        break
      case '--delay':
        opts.delayMs = parseInt(args[++i], 10) || 0
        break
      case '--load':
        opts.loadFile = args[++i]
        break
    }
  }

  return opts
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs()
  const sessionId = uuidv4()

  console.log('╔══════════════════════════════════════════╗')
  console.log('║    Chat with History Demo                ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log()
  console.log(`  Mode:    ${opts.mode}${opts.delayMs ? ` (${opts.delayMs}ms delay)` : ''}`)
  console.log(`  Session: ${sessionId.slice(0, 8)}...`)
  console.log()
  console.log('  Commands:')
  console.log('    /history  — show conversation so far')
  console.log('    /inspect  — show store state summary')
  console.log('    /save     — save store snapshot to disk')
  console.log('    /quit     — exit (auto-saves snapshot)')
  console.log()

  // Create LLMOS instance
  const { llmos, store } = createChatLLMOS(opts.mode, undefined, opts.delayMs)

  // Load previous state if requested
  if (opts.loadFile) {
    try {
      const data = await readFile(opts.loadFile, 'utf-8')
      store.load(JSON.parse(data))
      // Count existing chat turns
      const existingTurns = store
        .raw()
        .list('/kernel/tasks/')
        .filter((k) => k.endsWith('/meta'))
        .map((k) => store.raw().get(k) as TaskMeta)
        .filter((m) => m.name === 'chat-turn' && m.status === 'completed')
      console.log(
        `  Loaded ${existingTurns.length} previous chat turn(s) from ${opts.loadFile}`,
      )
      console.log()
    } catch (err) {
      console.error(`  Warning: Could not load ${opts.loadFile}: ${err}`)
      console.log()
    }
  }

  // Session state
  const conversationHistory: ConversationMessage[] = []
  let turnIndex = 0

  // Track session
  store
    .scope('/global/')
    .set(`sessions/${sessionId}/created`, new Date().toISOString())
  store.scope('/global/').set(`sessions/${sessionId}/turns`, [])

  // Set up readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = () => {
    rl.question('\x1b[36mYou:\x1b[0m ', async (input) => {
      const trimmed = input.trim()
      if (!trimmed) {
        prompt()
        return
      }

      // Handle commands
      if (trimmed.startsWith('/')) {
        await handleCommand(trimmed, store, conversationHistory, sessionId)
        prompt()
        return
      }

      // Run a chat turn
      const startTime = Date.now()
      console.log()

      try {
        const handle = llmos.spawn(chatTurnTask, {
          sessionId,
          userMessage: trimmed,
          turnIndex,
          conversationHistory: [...conversationHistory],
        })

        // Track turn in session
        const turns = store
          .scope('/global/')
          .get(`sessions/${sessionId}/turns`) as string[]
        turns.push(handle.id)

        const result = await handle.wait()
        const elapsed = Date.now() - startTime

        if (result.ok) {
          const { assistantMessage, searchUsed } = result.value

          // Update conversation history
          conversationHistory.push(
            { role: 'user', content: trimmed },
            { role: 'assistant', content: assistantMessage },
          )
          turnIndex++

          // Display response
          if (searchUsed) {
            console.log(`  \x1b[33m[searched history]\x1b[0m`)
          }
          console.log(`\x1b[32mAssistant:\x1b[0m ${assistantMessage}`)
          console.log(`  \x1b[90m(${elapsed}ms, turn ${turnIndex})\x1b[0m`)
        } else {
          console.log(`\x1b[31mError:\x1b[0m ${result.error.message}`)
        }
      } catch (err) {
        console.log(
          `\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : err}`,
        )
      }

      console.log()
      prompt()
    })
  }

  // Handle graceful exit
  rl.on('close', async () => {
    console.log('\n\nSaving snapshot...')
    await saveSnapshot(store)
    console.log('Goodbye!')
    process.exit(0)
  })

  prompt()
}

// ─── Commands ───────────────────────────────────────────────────────

async function handleCommand(
  command: string,
  store: import('llmos-v0').Store,
  history: ConversationMessage[],
  sessionId: string,
) {
  const cmd = command.split(' ')[0].toLowerCase()

  switch (cmd) {
    case '/history':
      showHistory(history)
      break

    case '/inspect':
      showInspect(store)
      break

    case '/save':
      await saveSnapshot(store)
      break

    case '/quit':
      console.log('\nSaving snapshot...')
      await saveSnapshot(store)
      console.log('Goodbye!')
      process.exit(0)

    default:
      console.log(`  Unknown command: ${cmd}`)
      console.log('  Available: /history, /inspect, /save, /quit')
  }
  console.log()
}

function showHistory(history: ConversationMessage[]) {
  if (history.length === 0) {
    console.log('  No conversation history yet.')
    return
  }

  console.log(`  \x1b[1mConversation History (${history.length / 2} turns):\x1b[0m`)
  console.log()
  for (let i = 0; i < history.length; i += 2) {
    const turnNum = i / 2 + 1
    const user = history[i]
    const assistant = history[i + 1]
    console.log(`  \x1b[36m[${turnNum}] You:\x1b[0m ${user.content}`)
    if (assistant) {
      console.log(
        `  \x1b[32m[${turnNum}] Assistant:\x1b[0m ${assistant.content.slice(0, 120)}${assistant.content.length > 120 ? '...' : ''}`,
      )
    }
    console.log()
  }
}

function showInspect(store: import('llmos-v0').Store) {
  const raw = store.raw()
  const allKeys = raw.list()

  // Group by top-level namespace
  const groups: Record<string, number> = {}
  for (const key of allKeys) {
    const parts = key.split('/')
    const ns = parts.length >= 2 ? `/${parts[1]}/` : key
    groups[ns] = (groups[ns] || 0) + 1
  }

  console.log(`  \x1b[1mStore State\x1b[0m`)
  console.log(`  Total keys: ${allKeys.length}`)
  console.log()
  for (const [ns, count] of Object.entries(groups).sort()) {
    console.log(`  ${ns}: ${count} keys`)
  }

  // Task summary
  const taskKeys = raw
    .list('/kernel/tasks/')
    .filter((k) => k.endsWith('/meta'))
  const tasks = taskKeys.map((k) => raw.get(k) as TaskMeta)

  const byStatus: Record<string, number> = {}
  const byName: Record<string, number> = {}
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1
    byName[t.name] = (byName[t.name] || 0) + 1
  }

  console.log()
  console.log(`  \x1b[1mTasks (${tasks.length}):\x1b[0m`)
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`    ${status}: ${count}`)
  }
  console.log(`  \x1b[1mBy type:\x1b[0m`)
  for (const [name, count] of Object.entries(byName)) {
    console.log(`    ${name}: ${count}`)
  }

  // AI requests
  const aiRequests = raw.get('/kernel/ai/requests') || []
  console.log()
  console.log(`  \x1b[1mAI Requests:\x1b[0m ${aiRequests.length}`)
}

async function saveSnapshot(store: import('llmos-v0').Store) {
  const path = 'store-snapshot.json'
  await writeFile(path, JSON.stringify(store.snapshot(), null, 2))
  console.log(`  Snapshot saved to ${path}`)
}

// ─── Run ────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
