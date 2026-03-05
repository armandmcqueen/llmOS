import { describe, it, expect } from 'vitest'
import { Store } from 'llmos-v0'
import type { TaskMeta } from 'llmos-v0'
import { readAllChatTurns } from '../history.js'
import type { StoredRequest, StoredResponse } from '../types.js'

/** Helper to seed a chat turn into the store. */
function seedChatTurn(
  store: Store,
  taskId: string,
  opts: {
    name?: string
    status?: TaskMeta['status']
    userContent?: string
    assistantContent?: string
    timestamp?: string
  } = {},
) {
  const raw = store.raw()
  const {
    name = 'chat-turn',
    status = 'completed',
    userContent = 'Hello',
    assistantContent = 'Hi there!',
    timestamp = new Date().toISOString(),
  } = opts

  // Write task metadata
  const meta: TaskMeta = {
    id: taskId,
    name,
    status,
    parentId: null,
    startTime: timestamp,
    endTime: status === 'completed' ? timestamp : null,
    error: null,
  }
  raw.set(`/kernel/tasks/${taskId}/meta`, meta)

  // Write request/response in task-local storage
  const request: StoredRequest = {
    role: 'user',
    content: userContent,
    timestamp,
  }
  const response: StoredResponse = {
    role: 'assistant',
    content: assistantContent,
    timestamp,
  }
  raw.set(`/task/${taskId}/request`, request)
  raw.set(`/task/${taskId}/response`, response)
}

describe('readAllChatTurns', () => {
  it('returns empty array when store has no tasks', () => {
    const store = new Store()
    const turns = readAllChatTurns(store.raw())
    expect(turns).toEqual([])
  })

  it('discovers completed chat turns', () => {
    const store = new Store()
    seedChatTurn(store, 'turn-1', {
      userContent: 'What is TypeScript?',
      assistantContent: 'TypeScript is a typed superset of JavaScript.',
      timestamp: '2026-01-01T00:00:00Z',
    })
    seedChatTurn(store, 'turn-2', {
      userContent: 'Tell me more',
      assistantContent: 'It adds static types to JavaScript.',
      timestamp: '2026-01-01T00:01:00Z',
    })

    const turns = readAllChatTurns(store.raw())
    expect(turns).toHaveLength(2)
    expect(turns[0].taskId).toBe('turn-1')
    expect(turns[0].request.content).toBe('What is TypeScript?')
    expect(turns[0].response.content).toBe(
      'TypeScript is a typed superset of JavaScript.',
    )
    expect(turns[1].taskId).toBe('turn-2')
  })

  it('returns turns in chronological order', () => {
    const store = new Store()
    // Seed in reverse order
    seedChatTurn(store, 'turn-late', {
      timestamp: '2026-01-01T00:10:00Z',
    })
    seedChatTurn(store, 'turn-early', {
      timestamp: '2026-01-01T00:01:00Z',
    })
    seedChatTurn(store, 'turn-mid', {
      timestamp: '2026-01-01T00:05:00Z',
    })

    const turns = readAllChatTurns(store.raw())
    expect(turns.map((t) => t.taskId)).toEqual([
      'turn-early',
      'turn-mid',
      'turn-late',
    ])
  })

  it('filters out non-chat-turn tasks', () => {
    const store = new Store()
    seedChatTurn(store, 'turn-1', { name: 'chat-turn' })
    seedChatTurn(store, 'worker-1', { name: 'search-worker-0' })
    seedChatTurn(store, 'coord-1', { name: 'search-coordinator' })

    const turns = readAllChatTurns(store.raw())
    expect(turns).toHaveLength(1)
    expect(turns[0].taskId).toBe('turn-1')
  })

  it('filters out running/errored tasks', () => {
    const store = new Store()
    seedChatTurn(store, 'turn-done', { status: 'completed' })
    seedChatTurn(store, 'turn-running', { status: 'running' })
    seedChatTurn(store, 'turn-errored', { status: 'errored' })

    const turns = readAllChatTurns(store.raw())
    expect(turns).toHaveLength(1)
    expect(turns[0].taskId).toBe('turn-done')
  })

  it('skips turns with missing request or response', () => {
    const store = new Store()
    const raw = store.raw()

    // Turn with metadata but no request/response
    const meta: TaskMeta = {
      id: 'incomplete',
      name: 'chat-turn',
      status: 'completed',
      parentId: null,
      startTime: '2026-01-01T00:00:00Z',
      endTime: '2026-01-01T00:00:01Z',
      error: null,
    }
    raw.set('/kernel/tasks/incomplete/meta', meta)

    // Turn with only request (no response)
    seedChatTurn(store, 'partial', {})
    raw.delete('/task/partial/response')

    // Complete turn
    seedChatTurn(store, 'complete', {})

    const turns = readAllChatTurns(store.raw())
    expect(turns).toHaveLength(1)
    expect(turns[0].taskId).toBe('complete')
  })

  it('respects excludeTaskIds', () => {
    const store = new Store()
    seedChatTurn(store, 'turn-1', {
      timestamp: '2026-01-01T00:00:00Z',
    })
    seedChatTurn(store, 'turn-2', {
      timestamp: '2026-01-01T00:01:00Z',
    })
    seedChatTurn(store, 'turn-3', {
      timestamp: '2026-01-01T00:02:00Z',
    })

    const turns = readAllChatTurns(store.raw(), ['turn-2'])
    expect(turns).toHaveLength(2)
    expect(turns.map((t) => t.taskId)).toEqual(['turn-1', 'turn-3'])
  })

  it('works alongside other store data', () => {
    const store = new Store()
    const raw = store.raw()

    // Add non-task data
    raw.set('/global/some/data', { foo: 'bar' })
    raw.set('/kernel/ai/requests', [])

    seedChatTurn(store, 'turn-1')

    const turns = readAllChatTurns(store.raw())
    expect(turns).toHaveLength(1)
  })
})
