/**
 * History discovery — reads all completed chat turns from the store.
 *
 * Uses the raw (unprefixed) store accessor to scan task metadata
 * and read request/response data from task-local storage.
 */

import type { StoreAccessor, TaskMeta } from 'llmos-v0'
import type { ChatTurn, StoredRequest, StoredResponse } from './types.js'

/**
 * Discover all completed chat turns by scanning task metadata.
 * Returns them in chronological order (by request timestamp).
 *
 * @param rawStore - Raw (unprefixed) store accessor
 * @param excludeTaskIds - Task IDs to skip (e.g. the current in-progress turn)
 */
export function readAllChatTurns(
  rawStore: StoreAccessor,
  excludeTaskIds?: string[],
): ChatTurn[] {
  // List all task metadata keys
  const allKeys = rawStore.list('/kernel/tasks/')
  const metaKeys = allKeys.filter((k) => k.endsWith('/meta'))

  const turns: ChatTurn[] = []

  for (const key of metaKeys) {
    const meta = rawStore.get(key) as TaskMeta | undefined
    if (!meta) continue

    // Only include completed chat-turn tasks
    if (meta.name !== 'chat-turn') continue
    if (meta.status !== 'completed') continue
    if (excludeTaskIds?.includes(meta.id)) continue

    // Read the stored request and response from task-local storage
    const request = rawStore.get(`/task/${meta.id}/request`) as
      | StoredRequest
      | undefined
    const response = rawStore.get(`/task/${meta.id}/response`) as
      | StoredResponse
      | undefined

    // Skip turns with missing data
    if (!request || !response) continue

    turns.push({ taskId: meta.id, request, response })
  }

  // Sort by timestamp (chronological order)
  turns.sort((a, b) =>
    a.request.timestamp.localeCompare(b.request.timestamp),
  )

  return turns
}
