/**
 * Chat-with-History demo — shared type definitions.
 */

// ─── Chat Turn ──────────────────────────────────────────────────────

/** Event passed to chatTurnTask when spawning a new turn. */
export interface ChatTurnEvent {
  sessionId: string
  userMessage: string
  /** 0-based index within the session */
  turnIndex: number
  /** Conversation history for context (previous turns in this session) */
  conversationHistory: ConversationMessage[]
}

/** Result returned by chatTurnTask. */
export interface ChatTurnResult {
  assistantMessage: string
  searchUsed: boolean
  turnIndex: number
}

/** A message in the conversation (for building context). */
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

// ─── Stored Chat Data ───────────────────────────────────────────────

/** What gets stored at /task/{taskId}/request */
export interface StoredRequest {
  role: 'user'
  content: string
  timestamp: string
}

/** What gets stored at /task/{taskId}/response */
export interface StoredResponse {
  role: 'assistant'
  content: string
  timestamp: string
}

/** A complete chat turn as read from the store. */
export interface ChatTurn {
  taskId: string
  request: StoredRequest
  response: StoredResponse
}

// ─── Search ─────────────────────────────────────────────────────────

/** Event passed to searchCoordinatorTask. */
export interface SearchEvent {
  query: string
  /** Task IDs to exclude from search (e.g. the current turn). */
  excludeTaskIds?: string[]
}

/** Event passed to each searchWorkerTask. */
export interface SearchWorkerEvent {
  chatTurn: ChatTurn
  query: string
}

/** Result from a single search worker. */
export interface SearchWorkerResult {
  taskId: string
  relevant: boolean
  summary: string
  relevantExcerpts: string[]
}

/** Aggregated result from the search coordinator. */
export interface SearchResult {
  query: string
  relevantTurns: SearchWorkerResult[]
  totalSearched: number
  synthesis: string
}
