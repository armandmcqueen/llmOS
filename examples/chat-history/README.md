# Chat with History Demo

An interactive chat where the AI agent can search through previous conversations to provide contextual responses. Demonstrates llmos-v0's tool-use loops, task spawning from tools, and the store as persistent conversational memory.

## Quick Start

```bash
# From examples/chat-history/

# Mock mode (no API key needed, instant responses)
pnpm cli

# Real mode (uses Haiku, needs API key)
ANTHROPIC_API_KEY=sk-... pnpm cli --real

# Mock mode with simulated latency
pnpm cli --delay 500

# Load a previous session's state
pnpm cli --load store-snapshot.json
```

## How It Works

Each user message spawns a `chat-turn` task. The AI has a `search_history` tool available — when it detects the user referencing past conversations, it invokes the tool, which spawns a **map-reduce search** over all previous chat turns:

```
User: "What did we discuss previously about TypeScript?"

-> chatTurnTask spawned
  -> AI calls search_history tool
    -> searchCoordinatorTask discovers 5 prior turns
      -> 5 searchWorkerTasks (parallel) evaluate relevance
      -> Coordinator synthesizes relevant excerpts
  -> AI incorporates search results into response
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `/history` | Show the conversation so far |
| `/inspect` | Show store state summary (keys, tasks, AI calls) |
| `/save` | Save store snapshot to disk |
| `/quit` | Exit and auto-save snapshot |

## Testing

```bash
pnpm test    # Run all tests (20 tests across 3 files)
```

The test suite covers:
- **history.test.ts**: Chat turn discovery from the store (chronological ordering, filtering, edge cases)
- **search.test.ts**: Map-reduce search over history (coordinator spawns workers, collects results)
- **chat.test.ts**: Full chat turn round-trip (tool loop, search integration, data storage)

## Store Schema

All data is stored in the llmos store with these paths:

```
/global/sessions/{sessionId}/turns     -> string[]   (ordered task IDs)
/global/sessions/{sessionId}/created   -> string     (ISO timestamp)

/task/{taskId}/request                 -> { role, content, timestamp }
/task/{taskId}/response                -> { role, content, timestamp }
/task/{taskId}/session                 -> string     (session ID)

/kernel/tasks/{taskId}/meta            -> TaskMeta   (status, timing)
/kernel/ai/requests                    -> array      (all AI call logs)
```

Use `/inspect` in the CLI or load `store-snapshot.json` to explore the full state.
