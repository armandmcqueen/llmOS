# Chat with History — Design

## Overview

This demo builds an interactive chat agent that can search its own conversation history using llmos-v0 primitives. It showcases three capabilities the book-search demo doesn't: **tool-use loops**, **task spawning from within tools**, and **the store as persistent memory**.

## Architecture

### Task Structure

```
chatTurnTask (per user message)
├── AI call with search_history tool
├── [if tool called] searchCoordinatorTask
│   ├── readAllChatTurns() — discover history from store
│   ├── searchWorkerTask-0 (parallel)
│   ├── searchWorkerTask-1 (parallel)
│   └── ...
│   └── Synthesis AI call
└── Final AI response with context
```

### Data Flow

1. User types a message in the CLI
2. CLI spawns a `chatTurnTask` with the message + conversation history
3. Task stores the user request at `/task/{taskId}/request`
4. Task calls AI with the `search_history` tool available
5. If AI calls the tool:
   a. Tool handler (closure over task context) spawns `searchCoordinatorTask`
   b. Coordinator calls `readAllChatTurns()` to discover all completed chat turns from `/kernel/tasks/*/meta`
   c. Coordinator spawns one `searchWorkerTask` per historical turn (parallel)
   d. Workers evaluate relevance using AI (or MockAI keyword matching)
   e. Coordinator synthesizes results and returns to the tool
   f. Tool result is fed back to the AI for a final response
6. Task stores the assistant response at `/task/{taskId}/response`
7. CLI displays the response and loops

### Manual Tool-Use Loop

The AI interface (`ai.ts`) doesn't currently pass `maxSteps` to Vercel AI SDK's `generateText()`. Rather than modifying the core, the `chatTurnTask` implements a manual loop:

```
for round in [0, MAX_ROUNDS):
  response = ai.request(messages, tools)
  if no tool calls: return response
  execute tool calls
  append results to messages
```

This has two advantages over `maxSteps`:
1. **Each AI call is logged separately** in the kernel store (better observability)
2. **The demo is self-contained** — no core changes needed

The loop is capped at 3 rounds to prevent runaway tool use.

### Tool as Closure

The `search_history` tool needs `ctx.spawn` to create the search coordinator as a child task. Since tool handlers are plain `async (params) => result` functions, the tool is constructed per-turn as a closure:

```typescript
function createSearchHistoryTool(ctx: TaskContext): Tool {
  return {
    name: 'search_history',
    execute: async (params) => {
      const handle = ctx.spawn(searchCoordinatorTask, { ... })
      return (await handle.wait()).value
    }
  }
}
```

### History Discovery

Instead of maintaining a separate index, chat turns are discovered by scanning task metadata:

1. `rawStore.list('/kernel/tasks/')` — get all task metadata keys
2. Filter for keys ending in `/meta`
3. Read each metadata object, filter for `name === 'chat-turn'` and `status === 'completed'`
4. Read request/response from `/task/{taskId}/request` and `/task/{taskId}/response`
5. Sort by timestamp

This is O(n) in total tasks but simple and requires no bookkeeping. For the demo scale (tens of turns), this is fine.

### MockAI

The MockAI simulates three behaviors, distinguished by inspecting the system prompt:

1. **Chat agent**: Returns a text response, or a `search_history` tool call when the user message contains keywords like "previous", "earlier", "remember", etc.
2. **Search worker**: Keyword-matches the search query against the chat turn content. Returns `relevant: true` if any query words (>3 chars) appear in the content.
3. **Search synthesis**: Returns a generic summary mentioning the count of relevant turns.

This mirrors the book-search MockAI pattern — structurally identical to real AI usage, deterministic and free.

## File Structure

```
src/
├── types.ts           Shared interfaces (ChatTurnEvent, SearchEvent, etc.)
├── history.ts         readAllChatTurns() — discovery from store
├── search.ts          searchCoordinatorTask + searchWorkerTask
├── chat.ts            chatTurnTask with manual tool loop
├── search-tool.ts     createSearchHistoryTool(ctx) factory
├── mock-ai.ts         MockAI with tool-call simulation
├── setup.ts           createChatLLMOS() wiring function
├── cli.ts             Interactive readline CLI
└── __tests__/
    ├── history.test.ts   8 tests — discovery, ordering, filtering
    ├── search.test.ts    5 tests — coordinator, workers, exclusion
    └── chat.test.ts      7 tests — tool loop, storage, integration
```

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Manual tool loop (not maxSteps) | No core changes needed; better per-call logging |
| History via task metadata scan | Simple, no separate index to maintain |
| Tool as closure over TaskContext | Needed for ctx.spawn; clean pattern |
| All Haiku | Cost-effective for conversational + search use |
| CLI first | Fastest path to working demo; web UI can layer on later |
| Session = one CLI run | Simple; persistence via snapshot load/save |

## Store Schema

```
/global/sessions/{sessionId}/turns       string[]     Ordered turn task IDs
/global/sessions/{sessionId}/created     string       ISO timestamp

/task/{taskId}/request                   StoredRequest   { role, content, timestamp }
/task/{taskId}/response                  StoredResponse  { role, content, timestamp }
/task/{taskId}/session                   string          Session ID

/kernel/tasks/{taskId}/meta              TaskMeta        Standard llmos metadata
/kernel/tasks/{taskId}/result            any             Task return value
/kernel/tasks/{taskId}/usage             object          AI token usage
/kernel/ai/requests                      array           All AI request/response logs
```

## What This Demonstrates (vs book-search)

| Capability | Book Search | Chat History |
|-----------|------------|-------------|
| Map-reduce task spawning | Yes | Yes (nested — tool spawns tasks) |
| Tool-use loop | No | Yes (manual loop with tool call/result cycle) |
| Task spawning from tools | No | Yes (search_history tool spawns coordinator) |
| Store as persistent memory | No (static book data) | Yes (conversations accumulate) |
| Cross-execution context | No | Yes (load previous snapshots) |
| Interactive multi-turn | No (single query) | Yes (readline loop) |
