import { describe, it, expect } from 'vitest'
import { Store, createSpawner, ToolboxImpl } from 'llmos-v0'
import type { TaskMeta } from 'llmos-v0'
import { MockAI } from '../mock-ai.js'
import { searchCoordinatorTask } from '../search.js'
import type { StoredRequest, StoredResponse } from '../types.js'

/** Helper to seed a completed chat turn into the store. */
function seedChatTurn(
  store: Store,
  taskId: string,
  userContent: string,
  assistantContent: string,
  timestamp: string,
) {
  const raw = store.raw()

  const meta: TaskMeta = {
    id: taskId,
    name: 'chat-turn',
    status: 'completed',
    parentId: null,
    startTime: timestamp,
    endTime: timestamp,
    error: null,
  }
  raw.set(`/kernel/tasks/${taskId}/meta`, meta)

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

describe('searchCoordinatorTask', () => {
  it('returns empty results when no chat history exists', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    const handle = spawn(searchCoordinatorTask, {
      query: 'test query',
    })

    const result = await handle.wait()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.totalSearched).toBe(0)
      expect(result.value.relevantTurns).toEqual([])
      expect(result.value.synthesis).toContain('No previous conversations')
    }
  })

  it('searches through chat history and finds relevant turns', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    // Seed some chat turns
    seedChatTurn(
      store,
      'turn-1',
      'What is TypeScript?',
      'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
      '2026-01-01T00:00:00Z',
    )
    seedChatTurn(
      store,
      'turn-2',
      'How do I make pasta?',
      'Boil water, add pasta, cook for 8-10 minutes.',
      '2026-01-01T00:01:00Z',
    )
    seedChatTurn(
      store,
      'turn-3',
      'Tell me about JavaScript frameworks',
      'Popular JavaScript frameworks include React, Vue, and Angular.',
      '2026-01-01T00:02:00Z',
    )

    // Search for TypeScript-related topics
    const handle = spawn(searchCoordinatorTask, {
      query: 'TypeScript JavaScript',
    })

    const result = await handle.wait()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.totalSearched).toBe(3)
      // MockAI keyword matching should find turns about TypeScript/JavaScript
      expect(result.value.relevantTurns.length).toBeGreaterThan(0)
    }
  })

  it('spawns one worker per chat turn', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    // Seed 3 turns
    for (let i = 0; i < 3; i++) {
      seedChatTurn(
        store,
        `turn-${i}`,
        `Message ${i}`,
        `Response ${i}`,
        `2026-01-01T00:0${i}:00Z`,
      )
    }

    const handle = spawn(searchCoordinatorTask, { query: 'test' })
    await handle.wait()

    // Check that worker tasks were created
    const allKeys = store.raw().list('/kernel/tasks/')
    const workerMetas = allKeys
      .filter((k) => k.endsWith('/meta'))
      .map((k) => store.raw().get(k) as TaskMeta)
      .filter((m) => m.name.startsWith('history-search-worker-'))

    expect(workerMetas).toHaveLength(3)
    // All workers should have completed
    for (const meta of workerMetas) {
      expect(meta.status).toBe('completed')
    }
  })

  it('respects excludeTaskIds', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    seedChatTurn(store, 'turn-1', 'Hello', 'Hi', '2026-01-01T00:00:00Z')
    seedChatTurn(store, 'turn-2', 'World', 'Hey', '2026-01-01T00:01:00Z')

    const handle = spawn(searchCoordinatorTask, {
      query: 'test',
      excludeTaskIds: ['turn-1'],
    })

    const result = await handle.wait()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.totalSearched).toBe(1)
    }
  })

  it('tracks AI usage for search operations', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    seedChatTurn(store, 'turn-1', 'Hello', 'Hi', '2026-01-01T00:00:00Z')

    const handle = spawn(searchCoordinatorTask, { query: 'test' })
    await handle.wait()

    // Check that AI requests were logged
    const aiRequests = kernelStore.get('ai/requests')
    expect(aiRequests).toBeDefined()
    expect(aiRequests.length).toBeGreaterThan(0)
  })
})
