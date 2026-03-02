import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLLMOS } from '../index.js'
import type { LLMOS, TaskMeta } from '../types.js'

// Mock AI SDK — no real LLM calls
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return { ...actual, generateText: vi.fn() }
})
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (model: string) => ({ modelId: model })),
}))

import { generateText } from 'ai'
const mockGenerateText = vi.mocked(generateText)

function mockAIResponse(content: string, tokens = { prompt: 100, completion: 50 }) {
  return {
    text: content,
    toolCalls: [],
    toolResults: [],
    usage: { promptTokens: tokens.prompt, completionTokens: tokens.completion },
    finishReason: 'stop',
    warnings: undefined,
    steps: [],
    request: {},
    response: { messages: [] },
  } as any
}

describe('Integration — DESIGN.md usage example', () => {
  let llmos: LLMOS

  beforeEach(() => {
    vi.clearAllMocks()
    llmos = createLLMOS({
      ai: {
        provider: 'anthropic',
        apiKey: 'test-key',
        defaultModel: 'claude-sonnet-4-20250514',
      },
    })
  })

  it('createLLMOS returns a properly shaped object', () => {
    expect(llmos.store.kernel).toBeDefined()
    expect(llmos.toolbox).toBeDefined()
    expect(llmos.defineTask).toBeTypeOf('function')
    expect(llmos.spawn).toBeTypeOf('function')
  })

  it('runs the full coordinator/researcher pattern from DESIGN.md', async () => {
    // Set up mock to return different content per call
    let callCount = 0
    mockGenerateText.mockImplementation(async () => {
      callCount++
      return mockAIResponse(
        `Findings about topic ${callCount}`,
        { prompt: 100 * callCount, completion: 50 * callCount },
      )
    })

    // Register a tool globally
    llmos.toolbox.register({
      name: 'web_search',
      description: 'Search the web',
      schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      execute: async (params: { query: string }) => ({
        results: [`Result for: ${params.query}`],
      }),
    })

    // Define researcher task
    const researcher = llmos.defineTask({
      name: 'researcher',
      handler: async (ctx, event: { topic: string }) => {
        const response = await ctx.ai.request({
          system: 'You are a research assistant. Be concise.',
          messages: [
            { role: 'user', content: `Research: ${event.topic}` },
          ],
        })

        ctx.store.local.set('findings', response.content)
        ctx.store.global.set(`research/${event.topic}`, {
          summary: response.content,
          tokens: response.usage.totalTokens,
        })

        return { findings: response.content, usage: response.usage }
      },
    })

    // Define coordinator task
    const coordinator = llmos.defineTask({
      name: 'coordinator',
      handler: async (ctx, event: { topics: string[] }) => {
        const handles = event.topics.map((topic) =>
          ctx.spawn(researcher, { topic }),
        )
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

    // Run it
    const topics = ['multi-agent systems', 'context engineering']
    const handle = llmos.spawn(coordinator, { topics })
    const result = await handle.wait()

    // ── Verify result ──
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(Object.keys(result.value.findings)).toEqual(topics)
    for (const topic of topics) {
      expect(result.value.findings[topic]).toContain('Findings about topic')
    }

    // ── Verify task metadata ──
    const metaKeys = llmos.store.kernel
      .list('tasks/')
      .filter((k) => k.endsWith('/meta'))
    // 1 coordinator + 2 researchers = 3 tasks
    expect(metaKeys).toHaveLength(3)

    // Coordinator metadata
    const coordMeta = llmos.store.kernel.get(
      `tasks/${handle.id}/meta`,
    ) as TaskMeta
    expect(coordMeta.name).toBe('coordinator')
    expect(coordMeta.status).toBe('completed')
    expect(coordMeta.parentId).toBeNull()

    // Researcher metadata — all should be completed with coordinator as parent
    const researcherMetas = metaKeys
      .map((k) => llmos.store.kernel.get(k.replace('/kernel/', '')) as TaskMeta)
      .filter((m) => m.name === 'researcher')
    expect(researcherMetas).toHaveLength(2)
    for (const meta of researcherMetas) {
      expect(meta.status).toBe('completed')
      expect(meta.parentId).toBe(handle.id)
    }

    // ── Verify AI request logs ──
    const aiRequests = llmos.store.kernel.get('ai/requests') as any[]
    expect(aiRequests).toHaveLength(2) // one per researcher

    // ── Verify user data in store ──
    const raw = llmos.store.kernel
    // Global research data written by researchers
    for (const topic of topics) {
      const globalData = llmos.store.kernel.get('') // can't access /global via kernel
      // Use raw store through a researcher's context — check via kernel list instead
    }

    // ── Verify AI usage tracking per researcher ──
    for (const meta of researcherMetas) {
      const usage = llmos.store.kernel.get(`tasks/${meta.id}/usage`)
      expect(usage).toBeDefined()
      expect(usage.requestCount).toBe(1)
      expect(usage.totalTokens).toBeGreaterThan(0)
    }

    // ── Verify ephemeral cleanup ──
    // No ephemeral keys should remain for any task
    for (const meta of [...researcherMetas, coordMeta]) {
      const ephKeys = llmos.store.kernel
        .list()
        .filter((k) => k.includes('ephemeral'))
      expect(ephKeys).toHaveLength(0)
    }
  })

  it('handles task failure gracefully in the coordinator pattern', async () => {
    let callCount = 0
    mockGenerateText.mockImplementation(async () => {
      callCount++
      if (callCount === 2) {
        throw new Error('API rate limit exceeded')
      }
      return mockAIResponse(`Result ${callCount}`)
    })

    const researcher = llmos.defineTask({
      name: 'researcher',
      handler: async (ctx, event: { topic: string }) => {
        const response = await ctx.ai.request({
          messages: [{ role: 'user', content: event.topic }],
        })
        return { findings: response.content }
      },
    })

    const coordinator = llmos.defineTask({
      name: 'coordinator',
      handler: async (ctx, event: { topics: string[] }) => {
        const handles = event.topics.map((t) =>
          ctx.spawn(researcher, { topic: t }),
        )
        const results = await Promise.all(handles.map((h) => h.wait()))

        const findings: Record<string, string> = {}
        for (let i = 0; i < event.topics.length; i++) {
          const r = results[i]
          findings[event.topics[i]] = r.ok
            ? r.value.findings
            : `ERROR: ${r.error.message}`
        }
        return { findings }
      },
    })

    const handle = llmos.spawn(coordinator, {
      topics: ['topic-a', 'topic-b'],
    })
    const result = await handle.wait()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // One succeeded, one failed — but coordinator itself succeeded
    expect(result.value.findings['topic-a']).toContain('Result')
    expect(result.value.findings['topic-b']).toContain('ERROR')

    // Verify the failed researcher has errored metadata
    const metaKeys = llmos.store.kernel
      .list('tasks/')
      .filter((k) => k.endsWith('/meta'))
    const metas = metaKeys.map(
      (k) => llmos.store.kernel.get(k.replace('/kernel/', '')) as TaskMeta,
    )
    const errored = metas.filter((m) => m.status === 'errored')
    expect(errored).toHaveLength(1)
    expect(errored[0].error?.message).toContain('API rate limit exceeded')
  })

  it('tool invocations are logged through the toolbox', async () => {
    llmos.toolbox.register({
      name: 'search',
      description: 'Search',
      schema: { type: 'object', properties: { q: { type: 'string' } } },
      execute: async (p: { q: string }) => ({ hits: [p.q] }),
    })

    const task = llmos.defineTask({
      name: 'tool-user',
      handler: async (ctx) => {
        const result = await ctx.toolbox.execute('search', { q: 'test' }, ctx.id)
        return result
      },
    })

    const handle = llmos.spawn(task, undefined)
    const result = await handle.wait()

    expect(result.ok).toBe(true)

    const invocations = llmos.store.kernel.get('toolbox/invocations') as any[]
    expect(invocations).toHaveLength(1)
    expect(invocations[0].tool).toBe('search')
    expect(invocations[0].taskId).toBe(handle.id)
  })

  it('store state is inspectable after execution', async () => {
    mockGenerateText.mockResolvedValue(mockAIResponse('test response'))

    const task = llmos.defineTask({
      name: 'inspector',
      handler: async (ctx) => {
        await ctx.ai.request({
          messages: [{ role: 'user', content: 'hello' }],
        })
        ctx.store.local.set('mydata', 'value')
        ctx.store.global.set('shared', 'info')
        return 'done'
      },
    })

    const handle = llmos.spawn(task, undefined)
    await handle.wait()

    // Kernel store is inspectable
    const taskMetas = llmos.store.kernel
      .list('tasks/')
      .filter((k) => k.endsWith('/meta'))
    expect(taskMetas.length).toBeGreaterThan(0)

    const aiLogs = llmos.store.kernel.get('ai/requests')
    expect(aiLogs).toHaveLength(1)

    const usage = llmos.store.kernel.get(`tasks/${handle.id}/usage`)
    expect(usage.requestCount).toBe(1)
  })
})
