/**
 * Chat turn task — the main per-turn task with manual tool-use loop.
 *
 * Each chat turn:
 * 1. Stores the user's request
 * 2. Calls the AI with the search_history tool available
 * 3. If AI invokes tools, executes them and feeds results back (loop)
 * 4. Stores the final assistant response
 */

import { defineTask } from 'llmos-v0'
import type { Message } from 'llmos-v0'
import { createSearchHistoryTool } from './search-tool.js'
import type {
  ChatTurnEvent,
  ChatTurnResult,
  StoredRequest,
  StoredResponse,
} from './types.js'

const SYSTEM_PROMPT = `You are a helpful assistant with access to a search_history tool that lets you search through previous conversations. Use it when the user references past discussions, asks about something mentioned before, or when historical context would improve your answer. Be conversational and helpful.`

const MAX_TOOL_ROUNDS = 3

export const chatTurnTask = defineTask<ChatTurnEvent, ChatTurnResult>({
  name: 'chat-turn',
  handler: async (ctx, event) => {
    // Store the user request
    const storedRequest: StoredRequest = {
      role: 'user',
      content: event.userMessage,
      timestamp: new Date().toISOString(),
    }
    ctx.store.local.set('request', storedRequest)
    ctx.store.local.set('session', event.sessionId)

    // Build the conversation messages
    const messages: Message[] = []

    // Add conversation history for context
    for (const msg of event.conversationHistory) {
      messages.push({ role: msg.role, content: msg.content })
    }

    // Add current user message
    messages.push({ role: 'user', content: event.userMessage })

    // Create the search tool bound to this task context
    const searchTool = createSearchHistoryTool(ctx)

    // Manual tool-use loop
    let searchUsed = false
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await ctx.ai.request({
        system: SYSTEM_PROMPT,
        messages,
        tools: [searchTool],
      })

      // If no tool calls, this is the final response
      if (response.toolCalls.length === 0) {
        const assistantMessage = response.content

        // Store the response
        const storedResponse: StoredResponse = {
          role: 'assistant',
          content: assistantMessage,
          timestamp: new Date().toISOString(),
        }
        ctx.store.local.set('response', storedResponse)

        return {
          assistantMessage,
          searchUsed,
          turnIndex: event.turnIndex,
        }
      }

      // AI wants to call tools — add assistant message with tool calls
      searchUsed = true
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls,
      })

      // Execute each tool call
      for (const tc of response.toolCalls) {
        let toolResult: string
        try {
          const result = await searchTool.execute(tc.arguments)
          toolResult = JSON.stringify(result)
        } catch (err) {
          toolResult = JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          })
        }

        messages.push({
          role: 'tool',
          content: toolResult,
          toolCallId: tc.id,
        })
      }
    }

    // If we exhausted tool rounds, return what we have
    const fallbackMessage =
      'I searched through our previous conversations but ran into complexity. Could you rephrase your question?'
    const storedResponse: StoredResponse = {
      role: 'assistant',
      content: fallbackMessage,
      timestamp: new Date().toISOString(),
    }
    ctx.store.local.set('response', storedResponse)

    return {
      assistantMessage: fallbackMessage,
      searchUsed,
      turnIndex: event.turnIndex,
    }
  },
})
