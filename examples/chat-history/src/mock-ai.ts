/**
 * MockAI for chat-history demo.
 *
 * Simulates three distinct AI behaviors based on the system prompt:
 * 1. Chat agent: returns text or search_history tool calls
 * 2. Search worker: keyword-matches query against chat content
 * 3. Search synthesis: combines relevant excerpts
 *
 * Implements the same AIInterface as the real AI, with full logging.
 */

import type {
  AIInterface,
  AIRequestParams,
  AIResponse,
  StoreAccessor,
} from 'llmos-v0'

export class MockAI implements AIInterface {
  private kernelStore: StoreAccessor
  private taskId: string | null
  private delayMs: number

  constructor(kernelStore: StoreAccessor, taskId?: string, delayMs = 0) {
    this.kernelStore = kernelStore
    this.taskId = taskId ?? null
    this.delayMs = delayMs
  }

  forTask(taskId: string): MockAI {
    return new MockAI(this.kernelStore, taskId, this.delayMs)
  }

  async request(params: AIRequestParams): Promise<AIResponse> {
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs))
    }
    const startTime = Date.now()

    const { content, toolCalls } = this.generateResponse(params)

    const response: AIResponse = {
      content,
      toolCalls,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      raw: null,
    }

    const durationMs = Date.now() - startTime

    // Log like the real AI
    this.kernelStore.append('ai/requests', {
      model: 'mock',
      request: {
        system: params.system,
        messages: params.messages,
        tools: params.tools?.map((t) => t.name) ?? [],
      },
      response: {
        content: response.content,
        toolCalls: response.toolCalls,
        usage: response.usage,
      },
      durationMs,
      timestamp: new Date().toISOString(),
      taskId: this.taskId,
    })

    // Track usage
    if (this.taskId) {
      const usageKey = `tasks/${this.taskId}/usage`
      const current = this.kernelStore.get(usageKey) ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      }
      this.kernelStore.set(usageKey, {
        promptTokens: current.promptTokens + response.usage.promptTokens,
        completionTokens:
          current.completionTokens + response.usage.completionTokens,
        totalTokens: current.totalTokens + response.usage.totalTokens,
        requestCount: current.requestCount + 1,
      })
    }

    return response
  }

  private generateResponse(params: AIRequestParams): {
    content: string
    toolCalls: AIResponse['toolCalls']
  } {
    const system = params.system ?? ''
    const userMessages = params.messages.filter((m) => m.role === 'user')
    const lastUserMsg = userMessages[userMessages.length - 1]?.content ?? ''

    // Search worker — evaluate relevance of a chat turn
    if (system.includes('evaluate whether this chat turn is relevant')) {
      return { content: this.mockSearchWorker(lastUserMsg), toolCalls: [] }
    }

    // Search synthesis — combine relevant excerpts
    if (system.includes('synthesize the relevant information')) {
      return { content: this.mockSearchSynthesis(lastUserMsg), toolCalls: [] }
    }

    // Chat agent — may call search_history tool
    // Check if this is a response after tool results (tool messages present)
    const hasToolResults = params.messages.some((m) => m.role === 'tool')
    if (hasToolResults) {
      // After search results come back, generate a final text response
      const toolContent = params.messages
        .filter((m) => m.role === 'tool')
        .map((m) => m.content)
        .join('\n')
      return {
        content: `Based on our previous conversations, here's what I found: ${toolContent.slice(0, 200)}`,
        toolCalls: [],
      }
    }

    // Check if we should trigger a search
    const historyKeywords = [
      'previous',
      'earlier',
      'before',
      'last time',
      'remember',
      'we discussed',
      'we talked',
      'history',
      'past',
    ]
    const shouldSearch = historyKeywords.some((kw) =>
      lastUserMsg.toLowerCase().includes(kw),
    )

    if (shouldSearch && params.tools?.some((t) => t.name === 'search_history')) {
      // Extract a search query from the user message
      const searchQuery = lastUserMsg.slice(0, 100)
      return {
        content: '',
        toolCalls: [
          {
            id: `mock-tc-${Date.now()}`,
            name: 'search_history',
            arguments: { query: searchQuery },
          },
        ],
      }
    }

    // Regular chat response
    return {
      content: `[Mock] I'd be happy to help with that. You said: "${lastUserMsg.slice(0, 100)}"`,
      toolCalls: [],
    }
  }

  private mockSearchWorker(userMsg: string): string {
    // Extract query and chat content from the message
    const queryMatch = userMsg.match(/Search query: "(.+?)"/i)
    const query = queryMatch?.[1]?.toLowerCase() ?? ''
    const content = userMsg.toLowerCase()

    // Simple keyword matching
    const queryWords = query.split(/\s+/).filter((w) => w.length > 3)
    const matches = queryWords.filter((w) => content.includes(w))
    const relevant = matches.length > 0

    return JSON.stringify({
      relevant,
      summary: relevant
        ? `This turn discusses topics related to: ${matches.join(', ')}`
        : 'Not relevant to the search query',
      relevantExcerpts: relevant
        ? [content.slice(0, 200)]
        : [],
    })
  }

  private mockSearchSynthesis(userMsg: string): string {
    const excerptCount = (userMsg.match(/Turn/g) || []).length
    return `[Mock synthesis] Found ${excerptCount} relevant conversation(s). The previous discussions covered topics related to the search query.`
  }
}
