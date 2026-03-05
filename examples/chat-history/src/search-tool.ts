/**
 * search_history tool factory.
 *
 * Creates a Tool that, when invoked, spawns a searchCoordinatorTask
 * as a child of the current task. The tool is constructed as a closure
 * over the TaskContext so it has access to ctx.spawn.
 */

import type { Tool, TaskContext } from 'llmos-v0'
import { searchCoordinatorTask } from './search.js'
import type { SearchResult } from './types.js'

/**
 * Create a search_history tool bound to the given task context.
 * Must be called inside a task handler to capture the spawn function.
 */
export function createSearchHistoryTool(ctx: TaskContext): Tool {
  return {
    name: 'search_history',
    description:
      'Search through all previous chat conversations to find relevant context. ' +
      'Use this when the user references past conversations, asks about something ' +
      'discussed before, or when historical context would help answer their question.',
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The search query to find relevant past conversations',
        },
      },
      required: ['query'],
    },
    execute: async (params: { query: string }): Promise<SearchResult> => {
      const handle = ctx.spawn(searchCoordinatorTask, {
        query: params.query,
        excludeTaskIds: [ctx.id],
      })
      const result = await handle.wait()
      if (!result.ok) {
        throw new Error(`History search failed: ${result.error.message}`)
      }
      return result.value
    },
  }
}
