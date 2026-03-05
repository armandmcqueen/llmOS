import { describe, it, expect } from 'vitest'
import { Store, createSpawner, ToolboxImpl } from 'llmos-v0'
import type { TaskMeta } from 'llmos-v0'
import { MockAI } from '../mock-ai.js'
import { chatTurnTask } from '../chat.js'
import { createChatLLMOS } from '../setup.js'
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

describe('chatTurnTask', () => {
  it('handles a simple chat turn without tool use', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    const handle = spawn(chatTurnTask, {
      sessionId: 'test-session',
      userMessage: 'Hello, how are you?',
      turnIndex: 0,
      conversationHistory: [],
    })

    const result = await handle.wait()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.assistantMessage).toBeTruthy()
      expect(result.value.searchUsed).toBe(false)
      expect(result.value.turnIndex).toBe(0)
    }
  })

  it('stores request and response in task-local storage', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    const handle = spawn(chatTurnTask, {
      sessionId: 'test-session',
      userMessage: 'Tell me about TypeScript',
      turnIndex: 0,
      conversationHistory: [],
    })

    const result = await handle.wait()
    expect(result.ok).toBe(true)

    // Check stored data
    const raw = store.raw()
    const request = raw.get(`/task/${handle.id}/request`) as StoredRequest
    expect(request).toBeDefined()
    expect(request.role).toBe('user')
    expect(request.content).toBe('Tell me about TypeScript')
    expect(request.timestamp).toBeTruthy()

    const response = raw.get(`/task/${handle.id}/response`) as StoredResponse
    expect(response).toBeDefined()
    expect(response.role).toBe('assistant')
    expect(response.content).toBeTruthy()
    expect(response.timestamp).toBeTruthy()
  })

  it('triggers search when user references history', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    // Seed some prior history so search has something to find
    seedChatTurn(
      store,
      'prior-turn-1',
      'What is TypeScript?',
      'TypeScript is a typed superset of JavaScript.',
      '2026-01-01T00:00:00Z',
    )

    // User references previous conversation
    const handle = spawn(chatTurnTask, {
      sessionId: 'test-session',
      userMessage:
        'What did we discuss previously about TypeScript?',
      turnIndex: 1,
      conversationHistory: [
        { role: 'user', content: 'What is TypeScript?' },
        {
          role: 'assistant',
          content: 'TypeScript is a typed superset of JavaScript.',
        },
      ],
    })

    const result = await handle.wait()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.searchUsed).toBe(true)
      expect(result.value.assistantMessage).toBeTruthy()
    }
  })

  it('stores session ID in task-local storage', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    const handle = spawn(chatTurnTask, {
      sessionId: 'my-session-123',
      userMessage: 'Hello',
      turnIndex: 0,
      conversationHistory: [],
    })

    await handle.wait()

    const session = store.raw().get(`/task/${handle.id}/session`)
    expect(session).toBe('my-session-123')
  })

  it('includes conversation history in AI messages', async () => {
    const store = new Store()
    const kernelStore = store.scope('/kernel/')
    const mockAI = new MockAI(kernelStore)
    const toolbox = new ToolboxImpl(kernelStore)
    const spawn = createSpawner(store, mockAI as any, toolbox)

    const handle = spawn(chatTurnTask, {
      sessionId: 'test-session',
      userMessage: 'Tell me more',
      turnIndex: 2,
      conversationHistory: [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
        { role: 'assistant', content: 'Second response' },
      ],
    })

    const result = await handle.wait()
    expect(result.ok).toBe(true)

    // Verify AI was called (check ai/requests log)
    const aiRequests = kernelStore.get('ai/requests')
    expect(aiRequests).toBeDefined()
    expect(aiRequests.length).toBeGreaterThan(0)

    // The first AI request should include the conversation history
    const firstReq = aiRequests[0]
    // 4 history messages + 1 current = 5 total
    expect(firstReq.request.messages.length).toBe(5)
  })
})

describe('createChatLLMOS', () => {
  it('creates a working LLMOS instance in mock mode', async () => {
    const { llmos, store } = createChatLLMOS('mock')

    const handle = llmos.spawn(chatTurnTask, {
      sessionId: 'test',
      userMessage: 'Hello',
      turnIndex: 0,
      conversationHistory: [],
    })

    const result = await handle.wait()
    expect(result.ok).toBe(true)

    // Verify store has data
    const allKeys = store.raw().list()
    expect(allKeys.length).toBeGreaterThan(0)
  })

  it('throws when real mode has no API key', () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    expect(() => createChatLLMOS('real')).toThrow('ANTHROPIC_API_KEY')

    if (original) {
      process.env.ANTHROPIC_API_KEY = original
    }
  })
})
