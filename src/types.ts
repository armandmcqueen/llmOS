// llm-os v0.1 — Shared type definitions
// No logic here, just interfaces and type aliases.

// ─── Store ───────────────────────────────────────────────────────────

export interface StoreAccessor {
  get(key: string): any | undefined
  set(key: string, value: any): void
  delete(key: string): boolean
  list(prefix?: string): string[]
  append(key: string, value: any): void
}

// ─── Tools ───────────────────────────────────────────────────────────

export interface Tool {
  name: string
  description: string
  schema: Record<string, any> // JSON Schema describing the parameters object
  execute: (params: any) => Promise<any>
}

export interface Toolbox {
  register(tool: Tool): void
  execute(name: string, params: any, taskId?: string): Promise<any>
  list(): Tool[]
  get(name: string): Tool | undefined
  toAITools(names?: string[]): Record<string, any>
}

// ─── AI Interface ────────────────────────────────────────────────────

export interface AIConfig {
  provider: string // e.g. 'anthropic', 'openai'
  apiKey: string
  defaultModel: string // used when request doesn't specify a model
}

export interface AIRequestParams {
  model?: string
  system?: string
  messages: Message[]
  tools?: Tool[]
  temperature?: number
  maxTokens?: number
  [key: string]: any
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  [key: string]: any
}

export interface AIResponse {
  content: string
  toolCalls: ToolCall[]
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  raw: any
}

export interface ToolCall {
  id: string
  name: string
  arguments: any
}

export interface AIInterface {
  request(params: AIRequestParams): Promise<AIResponse>
}

// ─── Tasks ───────────────────────────────────────────────────────────

export interface TaskDefinition<TEvent, TResult> {
  name: string
  tools?: Tool[]
  handler: (ctx: TaskContext, event: TEvent) => Promise<TResult>
}

export interface Handle<T> {
  id: string
  wait(): Promise<Result<T, TaskError>>
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export interface TaskError {
  message: string
  cause?: unknown
}

export interface TaskContext {
  id: string
  parentId: string | undefined
  store: {
    local: StoreAccessor
    ephemeral: StoreAccessor
    global: StoreAccessor
    raw: StoreAccessor
  }
  ai: AIInterface
  toolbox: Toolbox
  spawn: <TEvent, TResult>(
    task: TaskDefinition<TEvent, TResult>,
    event: TEvent,
  ) => Handle<TResult>
}

export interface TaskMeta {
  id: string
  name: string
  status: 'running' | 'completed' | 'errored'
  parentId: string | null
  startTime: string
  endTime: string | null
  error: { message: string; cause?: unknown } | null
}

// ─── System Entry Point ──────────────────────────────────────────────

export interface LLMOSConfig {
  ai: AIConfig
}

export interface LLMOS {
  store: {
    kernel: StoreAccessor
  }
  toolbox: Toolbox
  defineTask: <TEvent, TResult>(
    definition: TaskDefinition<TEvent, TResult>,
  ) => TaskDefinition<TEvent, TResult>
  spawn: <TEvent, TResult>(
    task: TaskDefinition<TEvent, TResult>,
    event: TEvent,
  ) => Handle<TResult>
}
