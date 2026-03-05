/**
 * Search tasks — map-reduce search over chat history.
 *
 * searchCoordinatorTask: discovers chat turns, spawns workers, synthesizes
 * searchWorkerTask: evaluates a single chat turn's relevance to a query
 */

import { defineTask } from 'llmos-v0'
import type { Handle } from 'llmos-v0'
import { readAllChatTurns } from './history.js'
import type {
  SearchEvent,
  SearchResult,
  SearchWorkerEvent,
  SearchWorkerResult,
  ChatTurn,
} from './types.js'

/** Evaluate a single chat turn for relevance to the search query. */
export const searchWorkerTask = defineTask<
  SearchWorkerEvent,
  SearchWorkerResult
>({
  name: 'history-search-worker',
  handler: async (ctx, event) => {
    const { chatTurn, query } = event

    const response = await ctx.ai.request({
      system: `You are a search assistant. Your job is to evaluate whether this chat turn is relevant to the search query. Respond with JSON: { "relevant": boolean, "summary": "brief summary of what this turn discusses", "relevantExcerpts": ["relevant quote 1", ...] }. If not relevant, return empty excerpts.`,
      messages: [
        {
          role: 'user',
          content: `Search query: "${query}"\n\nUser message: ${chatTurn.request.content}\n\nAssistant response: ${chatTurn.response.content}`,
        },
      ],
      maxTokens: 512,
    })

    try {
      const parsed = JSON.parse(response.content)
      return {
        taskId: chatTurn.taskId,
        relevant: Boolean(parsed.relevant),
        summary: parsed.summary ?? '',
        relevantExcerpts: Array.isArray(parsed.relevantExcerpts)
          ? parsed.relevantExcerpts
          : [],
      }
    } catch {
      // Fallback if AI doesn't return valid JSON
      const isRelevant =
        response.content.toLowerCase().includes('"relevant": true') ||
        response.content.toLowerCase().includes('"relevant":true')
      return {
        taskId: chatTurn.taskId,
        relevant: isRelevant,
        summary: response.content.slice(0, 100),
        relevantExcerpts: [],
      }
    }
  },
})

/** Create a named worker task for a specific index. */
function createSearchWorker(index: number) {
  return defineTask<SearchWorkerEvent, SearchWorkerResult>({
    name: `history-search-worker-${index}`,
    handler: searchWorkerTask.handler,
  })
}

/** Coordinate a map-reduce search over all chat history. */
export const searchCoordinatorTask = defineTask<SearchEvent, SearchResult>({
  name: 'history-search-coordinator',
  handler: async (ctx, event) => {
    const { query, excludeTaskIds } = event

    // Discover all completed chat turns
    const chatTurns = readAllChatTurns(ctx.store.raw, excludeTaskIds)

    if (chatTurns.length === 0) {
      return {
        query,
        relevantTurns: [],
        totalSearched: 0,
        synthesis: 'No previous conversations found to search.',
      }
    }

    // Spawn a worker for each chat turn
    const handles: { handle: Handle<SearchWorkerResult>; turn: ChatTurn }[] = []
    for (let i = 0; i < chatTurns.length; i++) {
      const worker = createSearchWorker(i)
      const handle = ctx.spawn(worker, {
        chatTurn: chatTurns[i],
        query,
      })
      handles.push({ handle, turn: chatTurns[i] })
    }

    // Wait for all workers
    const results = await Promise.all(
      handles.map(async ({ handle }) => {
        const result = await handle.wait()
        return result
      }),
    )

    // Collect relevant results
    const relevantTurns: SearchWorkerResult[] = []
    for (const result of results) {
      if (result.ok && result.value.relevant) {
        relevantTurns.push(result.value)
      }
    }

    // Synthesize results
    let synthesis: string
    if (relevantTurns.length === 0) {
      synthesis =
        'Searched through previous conversations but found nothing relevant to the query.'
    } else {
      const excerptText = relevantTurns
        .map(
          (r, i) =>
            `[Turn ${i + 1}] (task ${r.taskId.slice(0, 8)}): ${r.summary}\nExcerpts: ${r.relevantExcerpts.join('; ')}`,
        )
        .join('\n\n')

      const synthesisResponse = await ctx.ai.request({
        system: `You are a helpful assistant. Given relevant excerpts from previous conversations, synthesize the relevant information into a concise summary that would help answer the current query. Be specific about what was discussed.`,
        messages: [
          {
            role: 'user',
            content: `Query: "${query}"\n\nRelevant conversation excerpts:\n${excerptText}`,
          },
        ],
        maxTokens: 1024,
      })
      synthesis = synthesisResponse.content
    }

    return {
      query,
      relevantTurns,
      totalSearched: chatTurns.length,
      synthesis,
    }
  },
})
