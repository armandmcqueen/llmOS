import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Store } from '../store.js'
import { AIInterfaceImpl } from '../ai.js'
import type { AIConfig, StoreAccessor } from '../types.js'

// Mock the 'ai' package's generateText
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: vi.fn(),
  }
})

// Mock @ai-sdk/anthropic so it doesn't need a real API key
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => {
    return (model: string) => ({ modelId: model, provider: 'anthropic' })
  }),
}))

import { generateText } from 'ai'

const mockGenerateText = vi.mocked(generateText)

const TEST_CONFIG: AIConfig = {
  provider: 'anthropic',
  apiKey: 'test-key',
  defaultModel: 'claude-sonnet-4-20250514',
}

function makeGenerateTextResult(overrides: Record<string, any> = {}) {
  return {
    text: 'Hello from the LLM',
    toolCalls: [],
    toolResults: [],
    usage: { promptTokens: 100, completionTokens: 50 },
    finishReason: 'stop',
    warnings: undefined,
    steps: [],
    request: {},
    response: { messages: [] },
    ...overrides,
  }
}

describe('AIInterfaceImpl', () => {
  let store: Store
  let kernel: StoreAccessor
  let ai: AIInterfaceImpl

  beforeEach(() => {
    vi.clearAllMocks()
    store = new Store()
    kernel = store.scope('/kernel/')
    ai = new AIInterfaceImpl(TEST_CONFIG, kernel)
  })

  describe('request — basic', () => {
    it('calls generateText and returns mapped response', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      const response = await ai.request({
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Say hi' }],
      })

      expect(response.content).toBe('Hello from the LLM')
      expect(response.toolCalls).toEqual([])
      expect(response.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      })
      expect(response.raw).toBeDefined()
    })

    it('uses default model from config when none specified', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      await ai.request({
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            modelId: 'claude-sonnet-4-20250514',
          }),
        }),
      )
    })

    it('uses params.model when specified', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      await ai.request({
        model: 'claude-opus-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            modelId: 'claude-opus-4-20250514',
          }),
        }),
      )
    })

    it('passes system, temperature, maxTokens to generateText', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      await ai.request({
        system: 'Be concise.',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.5,
        maxTokens: 200,
      })

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'Be concise.',
          temperature: 0.5,
          maxTokens: 200,
        }),
      )
    })
  })

  describe('request — tool calls', () => {
    it('maps tool calls from SDK format to our format', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult({
          toolCalls: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'web_search',
              args: { query: 'test' },
            },
          ],
        }) as any,
      )

      const response = await ai.request({
        messages: [{ role: 'user', content: 'Search for test' }],
      })

      expect(response.toolCalls).toEqual([
        { id: 'call-1', name: 'web_search', arguments: { query: 'test' } },
      ])
    })

    it('passes tools to generateText when provided', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      await ai.request({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          {
            name: 'my_tool',
            description: 'A tool',
            schema: { type: 'object', properties: {} },
            execute: async () => 'result',
          },
        ],
      })

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.objectContaining({
            my_tool: expect.objectContaining({
              parameters: expect.anything(),
              execute: expect.any(Function),
            }),
          }),
        }),
      )
    })
  })

  describe('request — logging', () => {
    it('appends request log to kernel store', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      await ai.request({
        system: 'You are a researcher.',
        messages: [{ role: 'user', content: 'Research AI' }],
      })

      const logs = kernel.get('ai/requests')
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        model: 'claude-sonnet-4-20250514',
        request: {
          system: 'You are a researcher.',
          messages: [{ role: 'user', content: 'Research AI' }],
          tools: [],
        },
        response: {
          content: 'Hello from the LLM',
          toolCalls: [],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
        taskId: null,
      })
      expect(logs[0].durationMs).toBeTypeOf('number')
      expect(logs[0].timestamp).toBeTypeOf('string')
    })

    it('logs tool names in request (not full tool objects)', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      await ai.request({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          {
            name: 'search',
            description: 'Search',
            schema: {},
            execute: async () => null,
          },
          {
            name: 'calc',
            description: 'Calculate',
            schema: {},
            execute: async () => null,
          },
        ],
      })

      const logs = kernel.get('ai/requests')
      expect(logs[0].request.tools).toEqual(['search', 'calc'])
    })

    it('accumulates multiple request logs', async () => {
      mockGenerateText.mockResolvedValue(
        makeGenerateTextResult() as any,
      )

      await ai.request({ messages: [{ role: 'user', content: 'First' }] })
      await ai.request({ messages: [{ role: 'user', content: 'Second' }] })

      const logs = kernel.get('ai/requests')
      expect(logs).toHaveLength(2)
    })
  })

  describe('forTask — task-scoped instances', () => {
    it('tags logs with taskId', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      const taskAi = ai.forTask('task-abc')
      await taskAi.request({
        messages: [{ role: 'user', content: 'Hello' }],
      })

      const logs = kernel.get('ai/requests')
      expect(logs[0].taskId).toBe('task-abc')
    })

    it('tracks cumulative usage per task', async () => {
      mockGenerateText
        .mockResolvedValueOnce(
          makeGenerateTextResult({
            usage: { promptTokens: 100, completionTokens: 50 },
          }) as any,
        )
        .mockResolvedValueOnce(
          makeGenerateTextResult({
            usage: { promptTokens: 200, completionTokens: 100 },
          }) as any,
        )

      const taskAi = ai.forTask('task-xyz')
      await taskAi.request({
        messages: [{ role: 'user', content: 'First' }],
      })
      await taskAi.request({
        messages: [{ role: 'user', content: 'Second' }],
      })

      const usage = kernel.get('tasks/task-xyz/usage')
      expect(usage).toEqual({
        promptTokens: 300,
        completionTokens: 150,
        totalTokens: 450,
        requestCount: 2,
      })
    })

    it('does not track usage when no taskId', async () => {
      mockGenerateText.mockResolvedValueOnce(
        makeGenerateTextResult() as any,
      )

      await ai.request({
        messages: [{ role: 'user', content: 'Hello' }],
      })

      // No task-scoped usage should exist
      const keys = kernel.list('tasks/')
      expect(keys).toHaveLength(0)
    })

    it('forTask returns independent instance', async () => {
      const taskAi1 = ai.forTask('task-1')
      const taskAi2 = ai.forTask('task-2')

      mockGenerateText.mockResolvedValue(
        makeGenerateTextResult({
          usage: { promptTokens: 10, completionTokens: 5 },
        }) as any,
      )

      await taskAi1.request({
        messages: [{ role: 'user', content: 'Hello' }],
      })
      await taskAi2.request({
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(kernel.get('tasks/task-1/usage')?.requestCount).toBe(1)
      expect(kernel.get('tasks/task-2/usage')?.requestCount).toBe(1)
    })
  })

  describe('error handling', () => {
    it('throws unsupported provider error', async () => {
      const badAi = new AIInterfaceImpl(
        { ...TEST_CONFIG, provider: 'unsupported' },
        kernel,
      )

      await expect(
        badAi.request({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('Unsupported AI provider: unsupported')
    })
  })
})
