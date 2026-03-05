# Proposal: Store Namespacing for Execution Isolation

**Status:** Draft — not yet approved. User wants to think about whether more storage layers are needed.

## Problem

When running multiple searches in the book-search demo, the UI shows stale tasks, AI logs, and results from previous executions. All data lives in one flat key-value store with no isolation between executions.

Today the server creates one `Store` + one `LLMOS` at startup. Each search spawns tasks into the same store. The second search's `/kernel/tasks/` entries pile on top of the first's.

This is an OS-level concern — the application shouldn't need to manually clean up between executions.

## Current Store Architecture

```
Store (Map<string, any>)
  └─ scope(prefix) → StoreAccessor   (auto-prefixes all keys)
  └─ raw()         → StoreAccessor   (no prefix)
  └─ snapshot()    → plain object
  └─ load()        → replace all data
```

Each task gets scoped accessors:
- `ctx.store.local` → `/task/{taskId}/`
- `ctx.store.ephemeral` → `/ephemeral/tasks/{taskId}/` (auto-cleaned)
- `ctx.store.global` → `/global/`
- `ctx.store.raw` → full store access

Key paths in use today:
```
/kernel/tasks/{taskId}/meta      ← task metadata (status, times)
/kernel/tasks/{taskId}/result    ← return value
/kernel/tasks/{taskId}/usage     ← AI token usage
/kernel/ai/requests              ← array of all AI request logs
/kernel/toolbox/invocations      ← tool invocation logs
/global/book/meta                ← app data (book-search specific)
/global/chunks/{i}               ← app data
/task/{taskId}/...               ← task-local data
/ephemeral/tasks/{taskId}/...    ← auto-cleaned on task completion
```

## Proposed Solution: Namespace

A **Namespace** is a UUID-identified isolation boundary. All store paths within a namespace are transparently prefixed with `/ns/{id}/`. Code inside a namespace sees keys without the prefix — the interface is identical to today.

```
Stored as:     /ns/abc-123/kernel/tasks/t1/meta
Seen by code:  /kernel/tasks/t1/meta
```

### API

```typescript
class Namespace {
  readonly id: string

  scope(prefix: string): StoreAccessor   // prefixes with /ns/{id}/{prefix}
  raw(): StoreAccessor                    // all keys in this namespace
  snapshot(): Record<string, any>         // namespace data, prefix stripped
  load(snapshot: Record<string, any>)     // replace namespace data
}

class Store {
  namespace(id?: string): Namespace       // factory, auto-generates UUID
  // existing methods unchanged (operate on ALL data)
}
```

**Critical detail:** `list()` strips the namespace prefix from returned keys, so consumers get `/kernel/tasks/t1/meta` not `/ns/abc/kernel/tasks/t1/meta`.

### How it flows through the system

- `createSpawner(ns: Namespace, ...)` instead of `createSpawner(store: Store, ...)`
- Task scoping uses `ns.scope(...)` — same API, just namespaced underneath
- `createLLMOS` auto-creates a namespace internally (backward compatible)
- `ctx.store.raw` gives namespace-scoped raw access, not full store

### Book-search payoff

```typescript
const store = new Store()
// Load book once
const bookNs = store.namespace('book-data')
await loadBook(EPUB_PATH, bookNs.scope('/global/'), CHUNK_SIZE)

app.post('/api/search', async (c) => {
  const searchNs = store.namespace()  // fresh — no stale data
  // copy book data into search namespace
  // build LLMOS components against searchNs
  // spawn coordinator
})

app.get('/api/state', (c) => {
  return c.json(currentSearchNs?.snapshot() ?? {})  // only current execution
})
```

UI code needs zero changes — snapshot key structure is identical.

## Open Questions

### Are more storage layers needed?

The current model has four categories by convention (`kernel`, `global`, `task`, `ephemeral`), but they're all backed by the same `Map<string, any>`. Possible directions:

1. **Different durability per layer** — kernel/global could persist to disk while ephemeral stays in-memory
2. **Different access patterns** — global could be read-heavy (shared data), kernel could be append-heavy (logs)
3. **Different visibility rules** — kernel data visible to system only, global visible to all tasks in a namespace, local visible to one task
4. **Different backends** — in-memory for speed-critical paths, SQLite/filesystem for persistence, Redis for distributed

If any of these are on the horizon, the namespace design should account for them. For example, instead of one `Map<string, any>` behind everything, each layer could be a pluggable `StorageBackend` interface:

```typescript
interface StorageBackend {
  get(key: string): any
  set(key: string, value: any): void
  delete(key: string): boolean
  list(prefix?: string): string[]
}

// Then a namespace wires different backends per layer:
namespace.layer('kernel', inMemoryBackend)
namespace.layer('global', sqliteBackend)
```

### Should some data cross namespace boundaries?

In the book-search case, book chunks are the same across searches — copying them per namespace is simple but wasteful. Options:
- **Copy per namespace** (proposed) — simple, small cost for current scale
- **Shared read-only layer** — a namespace can mount another namespace's data as read-only
- **Global layer outside namespaces** — some paths bypass namespace isolation entirely

### What "things" get namespaces?

The proposal creates namespaces per execution (per search). But namespaces could also represent:
- **Agents** — each agent gets its own namespace
- **Sessions** — user sessions with isolated state
- **Applications** — different apps on the same OS
- **Tenants** — multi-tenant isolation

The policy of "who gets a namespace" is separate from the mechanism.

## What This Proposal Does NOT Change

- `StoreAccessor` interface — unchanged
- `TaskContext` interface — unchanged
- `LLMOS` interface — unchanged (or adds optional `namespaceId`)
- Task handler code — sees the same keys, same API
- UI code — snapshot format is identical
