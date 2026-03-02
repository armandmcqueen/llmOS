# llm-os v0.1 — Implementation Design

## What is llm-os?

llm-os is a TypeScript library that provides operating-system-level primitives for building LLM-based agents and multi-agent systems. It is **not** an agent framework — it does not have opinions about how agents should think, plan, reason, or coordinate. It provides the substrate that agents run on: storage, task lifecycle, tool execution, and an LLM interface.

The analogy is Linux. Linux doesn't tell your program how to work — it gives it processes, memory, a filesystem, and I/O. llm-os does the same for LLM agents: it gives them tasks, a store, a toolbox, and an AI interface. Any agent architecture can be built on top.

This is v0.1: in-memory, single-machine, minimal. The architecture must be compatible with a future distributed implementation, but nothing distributed is built now.

---

## Design Principles

1. **The OS has no opinions about agent behavior.** No built-in agent loops, no planning strategies, no coordination topologies, no workflow graphs. These belong in userland.
2. **Shared state over message passing.** Agents coordinate through a shared store, not by sending messages to each other. The store is the filesystem. This sidesteps the most common failure mode in multi-agent systems: context loss during handoffs.
3. **Tasks are processes, not agents.** A "task" is a unit of execution with a lifecycle. An "agent" is a higher-level concept that might span multiple tasks. The OS only knows about tasks.
4. **Everything is observable.** The OS automatically logs system events (LLM calls, tool invocations, task lifecycle). Task code decides what application-level events to log.
5. **Data lives forever (eventually).** v0.1 does not version the store, but the architecture assumes a future where all non-ephemeral writes are versioned. Do not design in ways that make versioning hard to add.

---

## Architecture Overview

Four primitives, one backing store:

```
┌─────────────────────────────────────────────────┐
│                  User Code                       │
│  (agent logic, coordination, context building)   │
├─────────────────────────────────────────────────┤
│                   llm-os                         │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Tasks   │ │ Toolbox  │ │  AI Interface    │ │
│  │          │ │          │ │  (Vercel AI SDK) │ │
│  └────┬─────┘ └────┬─────┘ └───────┬──────────┘ │
│       │            │               │             │
│  ┌────┴────────────┴───────────────┴──────────┐  │
│  │                  Store                      │  │
│  │         (in-memory Map<string, any>)        │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

All four primitives read/write the store. The store is the single source of truth for all system and application state.

---

## Scope

### In

- In-memory key-value store with path-based namespacing and scoped accessors
- Task lifecycle: define, spawn, wait for result
- Toolbox: register tools, execute with automatic logging
- AI interface: non-streaming LLM requests via Vercel AI SDK with automatic logging and usage tracking

### Out (deferred to future versions)

- Store versioning / history
- Watch / notify on store changes
- LLM streaming or task output streaming
- Task cancellation
- Timers / cron
- Batch LLM requests
- Token budgets / cost limiting
- The "contextbuilder" (an opinionated layer for intelligent context window construction, to be built on top of these primitives)

---

## Primitive 1: Store

### Purpose

The store is the shared filesystem of llm-os. All state — application data, task metadata, system event logs — lives here. It is a single in-memory `Map<string, any>` with path-based string keys and JSON-serializable values, accessed through scoped accessors that handle path prefixing.

### Core Interface

```typescript
interface StoreAccessor {
  get(key: string): any | undefined
  set(key: string, value: any): void
  delete(key: string): boolean
  list(prefix?: string): string[]
  append(key: string, value: any): void
}
```

**Behavior of each method:**

- `get(key)`: Returns the value at the resolved path, or `undefined` if not found.
- `set(key, value)`: Writes the value at the resolved path. Overwrites any existing value. `value` must be JSON-serializable.
- `delete(key)`: Deletes the key at the resolved path. Returns `true` if the key existed, `false` otherwise.
- `list(prefix?)`: Returns all keys under this accessor's scope. If `prefix` is provided, filters to keys starting with that prefix (within the scope). Returns resolved full paths.
- `append(key, value)`: If the key exists and holds an array, pushes `value` onto it. If the key does not exist, creates it with `[value]`. If the key exists but is not an array, throws an error.

### Scoped Accessors

The store is accessed through scoped accessors. Each accessor implements `StoreAccessor` and automatically prefixes keys before reading/writing the underlying map. This is the **only** difference between accessors — they are thin wrappers.

| Accessor | Available on | Path prefix | Purpose |
|---|---|---|---|
| `local` | `ctx.store` | `/task/{taskId}/` | Task-scoped persistent data. Any task can read another task's local store (via `raw`), but writes are namespaced to the owning task. |
| `ephemeral` | `ctx.store` | `/ephemeral/tasks/{taskId}/` | Task-scoped temporary data. Automatically deleted when the task completes (success or error). |
| `global` | `ctx.store` | `/global/` | Shared data accessible to all tasks. Syntactic sugar over `raw` with a `/global/` prefix. |
| `raw` | `ctx.store` | *(none)* | Direct access to any path in the store. No prefix applied. Use when you need to read another task's local store or access arbitrary paths. |
| `kernel` | `llmos.store` (not on ctx) | `/kernel/` | Reserved for system use. Task metadata, AI request logs, tool invocation logs. Not exposed to task code via `ctx`. Used internally by the kernel. |

**Example of path resolution:**

```typescript
// Given a task with id "abc-123":
ctx.store.local.set('findings', data)
// Resolves to key: "/task/abc-123/findings"

ctx.store.ephemeral.set('scratch', data)
// Resolves to key: "/ephemeral/tasks/abc-123/scratch"

ctx.store.global.set('shared/plan', data)
// Resolves to key: "/global/shared/plan"

ctx.store.raw.set('/task/other-task-id/findings', data)
// Resolves to key: "/task/other-task-id/findings"

// Internal kernel usage:
llmos.store.kernel.set('tasks/abc-123/meta', metadata)
// Resolves to key: "/kernel/tasks/abc-123/meta"
```

### Implementation

```typescript
class Store {
  private data: Map<string, any> = new Map()

  // Creates a scoped accessor with the given prefix
  scope(prefix: string): StoreAccessor {
    return {
      get: (key) => this.data.get(prefix + key),
      set: (key, value) => { this.data.set(prefix + key, value) },
      delete: (key) => this.data.delete(prefix + key),
      list: (filterPrefix?: string) => {
        const fullPrefix = prefix + (filterPrefix ?? '')
        return Array.from(this.data.keys())
          .filter(k => k.startsWith(fullPrefix))
      },
      append: (key, value) => {
        const fullKey = prefix + key
        const current = this.data.get(fullKey)
        if (current === undefined) {
          this.data.set(fullKey, [value])
        } else if (Array.isArray(current)) {
          current.push(value)
        } else {
          throw new Error(`Cannot append to non-array at ${fullKey}`)
        }
      }
    }
  }

  // Raw accessor with no prefix
  raw(): StoreAccessor {
    return this.scope('')
  }
}
```

**Ephemeral cleanup:** When a task completes (success or error), the kernel iterates all keys with prefix `/ephemeral/tasks/{id}/` and deletes them from the backing map. This happens after the handler returns (or throws) and after metadata is updated.

---

## Primitive 2: Tasks

### Purpose

Tasks are the process model of llm-os. A task is defined once (with a handler function and optional tools), then spawned zero or more times with a typed event. Each spawn creates an independent execution with its own ID, store namespace, and metadata. The caller receives a handle to wait for the result.

### Defining a Task

```typescript
interface TaskDefinition<TEvent, TResult> {
  name: string
  tools?: Tool[]
  handler: (ctx: TaskContext, event: TEvent) => Promise<TResult>
}

function defineTask<TEvent, TResult>(
  definition: TaskDefinition<TEvent, TResult>
): TaskDefinition<TEvent, TResult>
```

`defineTask` is a type-safe identity function. It does not register anything or cause side effects. It returns the definition object, now typed, so that `spawn` can enforce type safety on the event and result.

- `name`: Human-readable label for observability and debugging.
- `tools`: Optional array of `Tool` objects this task can use. These are registered with the toolbox when the task is spawned.
- `handler`: The task's behavior. Receives a `TaskContext` and the spawn event. Returns a result or throws.

### Spawning a Task

```typescript
function spawn<TEvent, TResult>(
  task: TaskDefinition<TEvent, TResult>,
  event: TEvent
): Handle<TResult>
```

`spawn` is synchronous from the caller's perspective — it returns a `Handle` immediately. The task executes asynchronously.

**What spawn does, step by step:**

1. Generate a UUID for the new task.
2. If the task has tools, register them with the toolbox (skip if already registered by name).
3. Write initial task metadata to the kernel store at `/kernel/tasks/{id}/meta`:
   ```json
   {
     "id": "uuid",
     "name": "researcher",
     "status": "running",
     "parentId": "parent-uuid-or-null",
     "startTime": "2025-03-01T00:00:00.000Z",
     "endTime": null,
     "error": null
   }
   ```
4. Create a `TaskContext` scoped to this task (details below).
5. Call `task.handler(ctx, event)` — do **not** await it. Capture the resulting promise.
6. Attach `.then()` and `.catch()` to the promise to handle completion (details below).
7. Return a `Handle<TResult>` backed by an internal promise that resolves when the handler completes.

**On handler success (the promise returned by handler resolves with value `T`):**

1. Write the return value to `/kernel/tasks/{id}/result`.
2. Update metadata: set `status` to `"completed"`, set `endTime`.
3. Delete all ephemeral keys (iterate keys with prefix `/ephemeral/tasks/{id}/` and delete each).
4. Resolve the handle's internal promise with `{ ok: true, value }`.

**On handler error (the promise returned by handler rejects):**

1. Update metadata: set `status` to `"errored"`, set `endTime`, set `error` to `{ message, cause }`.
2. Delete all ephemeral keys.
3. Resolve (not reject) the handle's internal promise with `{ ok: false, error: { message, cause } }`.

The handle's promise **never rejects**. Errors are values, not exceptions.

### Handle

```typescript
interface Handle<T> {
  id: string
  wait(): Promise<Result<T, TaskError>>
}

type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }

interface TaskError {
  message: string
  cause?: unknown
}
```

- `id`: The task's UUID. Can be used to read the task's store namespace via `ctx.store.raw`.
- `wait()`: Returns a promise that resolves when the task completes. Never rejects.

### TaskContext

```typescript
interface TaskContext {
  id: string
  parentId: string | undefined
  store: {
    local: StoreAccessor       // /task/{id}/
    ephemeral: StoreAccessor   // /ephemeral/tasks/{id}/
    global: StoreAccessor      // /global/
    raw: StoreAccessor         // no prefix
  }
  ai: AIInterface
  toolbox: Toolbox
  spawn: <TEvent, TResult>(
    task: TaskDefinition<TEvent, TResult>,
    event: TEvent
  ) => Handle<TResult>
}
```

- `id`: This task's UUID.
- `parentId`: The UUID of the task that spawned this one, or `undefined` if spawned from top-level.
- `store`: Scoped store accessors (see Store section). `local` and `ephemeral` are scoped to this task's ID. `global` and `raw` are not task-scoped.
- `ai`: A task-scoped AI interface instance. Delegates to the shared AI interface but tags all logs with this task's ID.
- `toolbox`: The shared toolbox instance. Invocation logs are tagged with this task's ID.
- `spawn`: Spawns a child task. Identical to `llmos.spawn` except it automatically sets the child's `parentId` to this task's ID.

**Assembling a TaskContext** (done inside `spawn`):

```typescript
function createTaskContext(
  taskId: string,
  parentId: string | undefined,
  store: Store,
  ai: AIInterfaceImpl,
  toolbox: Toolbox,
  spawnFn: (taskId: string) => <E, R>(def: TaskDefinition<E, R>, event: E) => Handle<R>
): TaskContext {
  return {
    id: taskId,
    parentId,
    store: {
      local: store.scope(`/task/${taskId}/`),
      ephemeral: store.scope(`/ephemeral/tasks/${taskId}/`),
      global: store.scope('/global/'),
      raw: store.raw(),
    },
    ai: ai.forTask(taskId),
    toolbox,
    spawn: spawnFn(taskId),
  }
}
```

---

## Primitive 3: Toolbox

### Purpose

The toolbox is the system-level gateway for tool registration and execution. All tool invocations flow through it, providing a single interception point for observability and (in future versions) resource management. Tools are typed functions with a name, description, JSON schema for parameters, and an execute function.

### Interfaces

```typescript
interface Tool {
  name: string
  description: string
  schema: Record<string, any>  // JSON Schema describing the parameters object
  execute: (params: any) => Promise<any>
}

interface Toolbox {
  register(tool: Tool): void
  execute(name: string, params: any, taskId?: string): Promise<any>
  list(): Tool[]
  get(name: string): Tool | undefined
  toAITools(names?: string[]): any[]
}
```

### Behavior

**`register(tool)`:** Stores the tool by name. If a tool with the same name is already registered, it is overwritten silently.

**`execute(name, params, taskId?)`:**

1. Look up the tool by name. If not found, throw an error.
2. Record the start time.
3. Call `tool.execute(params)` and await the result.
4. Record the end time and duration.
5. On success: append an invocation log to `/kernel/toolbox/invocations`:
   ```json
   {
     "tool": "web_search",
     "params": { "query": "multi-agent systems" },
     "result": { "...": "..." },
     "durationMs": 1234,
     "timestamp": "2025-03-01T00:00:00.000Z",
     "taskId": "uuid-or-null"
   }
   ```
6. Return the result.
7. On error: append the invocation log with an `error` field instead of `result`, then re-throw the error.

**`list()`:** Returns all registered tools as an array.

**`get(name)`:** Returns a single tool by name, or `undefined`.

**`toAITools(names?)`:** Converts registered tools to the format expected by the Vercel AI SDK for LLM function calling. If `names` is provided, only those tools are included. This allows the AI interface to pass tool definitions to the LLM. The output format should match what the Vercel AI SDK's `generateText` expects in its `tools` parameter. Consult the Vercel AI SDK documentation for the exact format at implementation time.

### Implementation

```typescript
class ToolboxImpl implements Toolbox {
  private tools: Map<string, Tool> = new Map()
  private kernelStore: StoreAccessor

  constructor(kernelStore: StoreAccessor) {
    this.kernelStore = kernelStore
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  async execute(name: string, params: any, taskId?: string): Promise<any> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool not found: ${name}`)

    const startTime = Date.now()
    try {
      const result = await tool.execute(params)
      this.kernelStore.append('toolbox/invocations', {
        tool: name, params, result,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        taskId: taskId ?? null,
      })
      return result
    } catch (err) {
      this.kernelStore.append('toolbox/invocations', {
        tool: name, params,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        taskId: taskId ?? null,
      })
      throw err
    }
  }

  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  toAITools(names?: string[]): any[] {
    const tools = names
      ? names.map(n => this.tools.get(n)).filter(Boolean) as Tool[]
      : Array.from(this.tools.values())

    // Convert to Vercel AI SDK tool format.
    // The exact format depends on the Vercel AI SDK version.
    // Typically each tool needs: name, description, parameters (as JSON schema).
    // Consult: https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema,
      }
    }))
  }
}
```

---

## Primitive 4: AI Interface

### Purpose

The AI interface is the gateway for all LLM compute. It wraps the Vercel AI SDK's `generateText` function, adding automatic logging and usage tracking. It does **not** construct prompts, manage conversation history, or assemble context — it receives a fully formed request and sends it. Prompt construction is the responsibility of the task handler (or a future "contextbuilder" layer built on top of llm-os).

### Interfaces

```typescript
interface AIInterface {
  request(params: AIRequestParams): Promise<AIResponse>
}

interface AIRequestParams {
  model?: string           // overrides default model from config
  system?: string          // system prompt
  messages: Message[]      // conversation messages
  tools?: Tool[]           // tools available for this request
  temperature?: number
  maxTokens?: number
  [key: string]: any       // passthrough for provider-specific params
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string      // required for role: 'tool' (tool result messages)
  [key: string]: any       // provider-specific fields
}

interface AIResponse {
  content: string                // text content of the response
  toolCalls: ToolCall[]          // tool calls requested by the model (empty array if none)
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  raw: any                       // full response object from Vercel AI SDK for debugging
}

interface ToolCall {
  id: string
  name: string
  arguments: any                 // parsed arguments object
}
```

### Behavior

**`request(params)`** does the following:

1. Resolve the model: use `params.model` if provided, otherwise the default model from config.
2. Translate `params` to the Vercel AI SDK's `generateText` format. If `params.tools` is provided, convert them to the SDK's expected format.
3. Call `generateText` (non-streaming) via the Vercel AI SDK.
4. Map the SDK response to `AIResponse`: extract text content, tool calls, and usage statistics.
5. Log the request/response to the kernel store by appending to `/kernel/ai/requests`:
   ```json
   {
     "model": "claude-sonnet-4-20250514",
     "request": {
       "system": "You are a researcher.",
       "messages": [{ "role": "user", "content": "Research: multi-agent systems" }],
       "tools": ["web_search"]
     },
     "response": {
       "content": "Here are my findings...",
       "toolCalls": [],
       "usage": { "promptTokens": 150, "completionTokens": 500, "totalTokens": 650 }
     },
     "durationMs": 3200,
     "timestamp": "2025-03-01T00:00:00.000Z",
     "taskId": "uuid-or-null"
   }
   ```
6. Update cumulative token usage for the task at `/kernel/tasks/{taskId}/usage`. Read the current value (or create `{ promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 }`), add this request's usage, write back:
   ```json
   {
     "promptTokens": 1500,
     "completionTokens": 3200,
     "totalTokens": 4700,
     "requestCount": 5
   }
   ```
7. Return the `AIResponse`.

**Important:** Tool calls in the response are **not** automatically executed. The AI interface is pure I/O. If the model requests a tool call, the task handler is responsible for calling `ctx.toolbox.execute()` with the tool call arguments and sending the result back in a subsequent `ctx.ai.request()` with a `{ role: 'tool' }` message. This keeps the AI interface simple and gives the task full control over the agent loop.

### Task-scoped AI instances

The AI interface is shared across all tasks, but logs need to be tagged with the originating task's ID. The implementation should support creating a task-scoped wrapper:

```typescript
class AIInterfaceImpl implements AIInterface {
  private config: AIConfig
  private kernelStore: StoreAccessor
  private taskId: string | null

  constructor(config: AIConfig, kernelStore: StoreAccessor, taskId?: string) {
    this.config = config
    this.kernelStore = kernelStore
    this.taskId = taskId ?? null
  }

  // Returns a new instance scoped to a specific task ID.
  // Used when assembling TaskContext.
  forTask(taskId: string): AIInterfaceImpl {
    return new AIInterfaceImpl(this.config, this.kernelStore, taskId)
  }

  async request(params: AIRequestParams): Promise<AIResponse> {
    const model = params.model ?? this.config.defaultModel
    const startTime = Date.now()

    // Call Vercel AI SDK.
    // Import and provider setup depends on chosen provider:
    //   import { generateText } from 'ai'
    //   import { anthropic } from '@ai-sdk/anthropic'
    //   import { openai } from '@ai-sdk/openai'
    //
    // The model argument to generateText is a provider model instance:
    //   generateText({ model: anthropic('claude-sonnet-4-20250514'), ... })
    //
    // Consult Vercel AI SDK docs for exact API at implementation time:
    //   https://sdk.vercel.ai/docs/ai-sdk-core/generating-text

    const result = await generateText({
      model: createProviderModel(this.config.provider, model, this.config.apiKey),
      system: params.system,
      messages: params.messages,
      tools: params.tools ? formatToolsForSDK(params.tools) : undefined,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    })

    const response: AIResponse = {
      content: result.text ?? '',
      toolCalls: (result.toolCalls ?? []).map(tc => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.args,
      })),
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
      },
      raw: result,
    }

    const durationMs = Date.now() - startTime

    // Log to kernel store
    this.kernelStore.append('ai/requests', {
      model,
      request: {
        system: params.system,
        messages: params.messages,
        tools: params.tools?.map(t => t.name) ?? [],
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

    // Update cumulative usage for this task
    if (this.taskId) {
      const usageKey = `tasks/${this.taskId}/usage`
      const current = this.kernelStore.get(usageKey) ?? {
        promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0,
      }
      this.kernelStore.set(usageKey, {
        promptTokens: current.promptTokens + response.usage.promptTokens,
        completionTokens: current.completionTokens + response.usage.completionTokens,
        totalTokens: current.totalTokens + response.usage.totalTokens,
        requestCount: current.requestCount + 1,
      })
    }

    return response
  }
}
```

**Helper functions** `createProviderModel` and `formatToolsForSDK` bridge between llm-os types and the Vercel AI SDK. Their exact implementation depends on the SDK version. They should be isolated in the `ai.ts` module so they're easy to update if the SDK changes.

### Configuration

```typescript
interface AIConfig {
  provider: string       // e.g. 'anthropic', 'openai'
  apiKey: string
  defaultModel: string   // used when request doesn't specify a model
}
```

---

## System Entry Point

### createLLMOS

```typescript
interface LLMOSConfig {
  ai: AIConfig
}

interface LLMOS {
  store: {
    kernel: StoreAccessor       // /kernel/ namespace, exposed for debugging/inspection
  }
  toolbox: Toolbox
  defineTask: <TEvent, TResult>(
    definition: TaskDefinition<TEvent, TResult>
  ) => TaskDefinition<TEvent, TResult>
  spawn: <TEvent, TResult>(
    task: TaskDefinition<TEvent, TResult>,
    event: TEvent
  ) => Handle<TResult>
}

function createLLMOS(config: LLMOSConfig): LLMOS
```

**What `createLLMOS` does:**

1. Create a `Store` instance (the single backing `Map`).
2. Create the kernel store accessor: `store.scope('/kernel/')`.
3. Create a `ToolboxImpl`, passing the kernel store accessor for logging.
4. Create an `AIInterfaceImpl`, passing the AI config and kernel store accessor.
5. Return the `LLMOS` object:
    - `store.kernel`: Exposed for debugging. Lets the user inspect task metadata, AI request logs, etc.
    - `toolbox`: The global toolbox instance.
    - `defineTask`: The type-safe identity function (no state, just returns the definition).
    - `spawn`: Creates and executes a task. Internally: generates ID, writes metadata, assembles `TaskContext` (with scoped store accessors, task-scoped AI via `ai.forTask(id)`, toolbox reference, and a child-spawn function that sets `parentId`), calls the handler asynchronously, wires up completion/error handling, returns the `Handle`.

---

## Complete Usage Example

```typescript
import { createLLMOS } from 'llm-os'

// 1. Initialize the system
const llmos = createLLMOS({
  ai: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    defaultModel: 'claude-sonnet-4-20250514',
  }
})

// 2. Register tools globally
llmos.toolbox.register({
  name: 'web_search',
  description: 'Search the web for information',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' }
    },
    required: ['query']
  },
  execute: async (params: { query: string }) => {
    // Real implementation would call a search API
    return { results: [`Result for: ${params.query}`] }
  }
})

// 3. Define a simple research task
const researcher = llmos.defineTask({
  name: 'researcher',
  handler: async (ctx, event: { topic: string }) => {
    // Make an LLM call
    const response = await ctx.ai.request({
      system: 'You are a research assistant. Be concise.',
      messages: [
        { role: 'user', content: `Research the following topic: ${event.topic}` }
      ],
    })

    // Store findings in task-local storage
    ctx.store.local.set('findings', response.content)

    // Store a summary in global storage for other tasks to see
    ctx.store.global.set(`research/${event.topic}`, {
      summary: response.content,
      tokens: response.usage.totalTokens,
    })

    return { findings: response.content, usage: response.usage }
  }
})

// 4. Define a coordinator that spawns subtasks
const coordinator = llmos.defineTask({
  name: 'coordinator',
  handler: async (ctx, event: { topics: string[] }) => {
    // Spawn a researcher for each topic (they run concurrently)
    const handles = event.topics.map(topic =>
      ctx.spawn(researcher, { topic })
    )

    // Wait for all to complete
    const results = await Promise.all(handles.map(h => h.wait()))

    // Collect findings, handling errors
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
  }
})

// 5. Run it
const handle = llmos.spawn(coordinator, {
  topics: ['multi-agent systems', 'context engineering', 'sleep-time compute']
})
const result = await handle.wait()

if (result.ok) {
  console.log('Research complete:', Object.keys(result.value.findings))
} else {
  console.error('Coordinator failed:', result.error.message)
}

// 6. Inspect system state
const taskKeys = llmos.store.kernel.list('tasks/')
console.log('Task metadata keys:', taskKeys)

const aiRequests = llmos.store.kernel.get('ai/requests')
console.log(`Total AI requests: ${aiRequests?.length ?? 0}`)

const toolInvocations = llmos.store.kernel.get('toolbox/invocations')
console.log(`Total tool invocations: ${toolInvocations?.length ?? 0}`)
```

---

## File Structure

```
llm-os/
  src/
    index.ts          # createLLMOS factory function, LLMOS interface
    types.ts          # All shared types: Result, TaskError, StoreAccessor,
                      #   TaskDefinition, Handle, TaskContext, Tool, Toolbox,
                      #   AIInterface, AIRequestParams, AIResponse, Message,
                      #   ToolCall, LLMOSConfig, AIConfig, LLMOS
    store.ts          # Store class with scope() and raw() methods
    task.ts           # defineTask function, spawn logic, Handle implementation,
                      #   TaskContext assembly, ephemeral cleanup
    toolbox.ts        # ToolboxImpl class
    ai.ts             # AIInterfaceImpl class, provider model helpers
  package.json
  tsconfig.json
```

---

## Implementation Order

Build and test each module independently, then wire together.

**Step 1: `types.ts`**
Define all interfaces and type aliases listed in the file structure comment above. No logic, just types. This file is imported by everything else.

**Step 2: `store.ts`**
Implement `Store` class with `scope(prefix)` and `raw()` methods.
Test: create store, create scoped accessors with different prefixes, verify all five operations (get/set/delete/list/append) prefix correctly. Verify `list` filters by prefix. Verify `append` creates new arrays, appends to existing arrays, and throws on non-arrays.

**Step 3: `toolbox.ts`**
Implement `ToolboxImpl`. Constructor takes a kernel store accessor.
Test: register a tool, execute it, verify the result is returned. Verify the invocation is logged to the kernel store. Verify error handling: tool not found throws, tool.execute throwing is logged and re-thrown. Test `toAITools` produces reasonable output.

**Step 4: `ai.ts`**
Implement `AIInterfaceImpl`. Constructor takes AIConfig and kernel store accessor.
Test: mock the Vercel AI SDK `generateText` call. Verify the request is translated and forwarded correctly. Verify the response is mapped to AIResponse. Verify logging to `/kernel/ai/requests`. Verify cumulative usage tracking at `/kernel/tasks/{id}/usage`. Test `forTask` returns a scoped instance.

**Step 5: `task.ts`**
Implement `defineTask` (trivial identity function), `spawn`, and `Handle`.
`spawn` needs references to the store, toolbox, and AI interface to assemble `TaskContext`.
Test: spawn a task with a simple sync handler, verify `handle.wait()` resolves with `{ ok: true, value }`. Test error case resolves with `{ ok: false, error }`. Test ephemeral cleanup. Test `ctx.spawn` sets parentId. Verify task metadata is written at each lifecycle stage.

**Step 6: `index.ts`**
Implement `createLLMOS`. Instantiate Store, kernel accessor, ToolboxImpl, AIInterfaceImpl. Wire spawn to have access to all dependencies.
Test: the complete usage example above should work end-to-end with a mocked AI provider.

---

## Dependencies

```json
{
  "dependencies": {
    "ai": "^4",
    "@ai-sdk/anthropic": "^1",
    "uuid": "^9"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^2"
  }
}
```

Pin exact versions at implementation time. Add `@ai-sdk/openai` if OpenAI support is needed.

---

## Testing Strategy

- **Store:** Pure in-memory, no dependencies. Test directly.
- **Toolbox:** Pass a real store. Register mock tools. Verify execution, logging, and error behavior.
- **AI Interface:** Mock `generateText` from the Vercel AI SDK. Do not make real LLM calls in unit tests. Verify request translation, response mapping, logging, and usage tracking.
- **Tasks:** Use a real store and toolbox with a mocked AI interface. Test lifecycle: running → completed, running → errored. Test ephemeral cleanup. Test parent-child spawn.
- **Integration:** One end-to-end test using the full usage example with a mocked LLM provider. Verify store state after execution (task metadata, AI logs, tool logs, user data all in expected locations).