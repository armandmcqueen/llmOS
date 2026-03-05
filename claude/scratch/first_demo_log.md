# first_demo branch — Log

## 2026-03-02T00:00:00Z — Session start
- Read plan for book-search agent demo
- Explored llmos-v0 codebase (store, tasks, AI, toolbox)
- Explored epub extraction code from armand.dev
- Starting M0 implementation

## 2026-03-02T11:13:10Z — M0+M1 complete, M2 in progress

### M0: Workspace + epub extraction
- Created `pnpm-workspace.yaml` (pnpm uses this, not package.json workspaces)
- Created `examples/book-search/` with package.json, tsconfig
- Adapted epub extraction from armand.dev → `server/src/epub.ts`
- Added `"type": "module"` to root package.json for ESM resolution
- Changed root main to `src/index.ts` for workspace dev (no build needed)
- Verified: 52 chapters, 78,887 words from "The Hard Thing About Hard Things"

### M1: Chunking + agent logic
- Created `chunk.ts` — paragraph-boundary splitting
- Created `agent.ts` — coordinator spawns numbered workers, MockAI with keyword matching
- Fixed bug: `result.relevant` → `result.value.relevant` (Result wrapper)
- Added exports to llmos-v0 core: `Store`, `createSpawner`, `ToolboxImpl`, `AIInterfaceImpl`
- Reduced workers from 261 to 10 (increased chunk size to 50K)
- Workers now have numbered names: `search-worker-0` through `search-worker-9`

### Store serialization
- Added `Store.snapshot()` and `Store.load()` to core
- Created `store-cli.ts` with summary/ls/tree/get/dump/load commands
- `loadSnapshotFromDisk()` exported for reuse by server
- Agent demo dumps `store-snapshot.json` after each run

### Commander CLI
- Installed commander, created unified `cli.ts` entry point
- Commands: `extract`, `search`, `inspect` (with subcommands)
- `inspect` has `--file` option defaulting to `store-snapshot.json`
- Renamed scripts to avoid pnpm built-in conflicts (`store` → `inspect` → unified `cli`)

### M2: Web server (in progress)
- Created `server.ts` — Hono server with CORS, POST /api/search, GET /api/state, GET /
- Supports MODE=mock|real, PORT, EPUB_PATH, CHUNK_SIZE env vars
- Port 3000 was occupied, killed stale process — not yet tested

## 2026-03-02T11:43:48Z — Live agent visualization

### MockAI delay
- Added `delayMs` field to MockAI (default 0), propagated through `forTask()`
- Added `await new Promise(r => setTimeout(r, this.delayMs))` at top of `request()`
- Updated `createLLMOSWithStore(mode, apiKey?, delayMs?)` to pass delay

### Server config
- Added `MOCK_DELAY_MS` env var (default 1000ms) to `server.ts`
- Passed to `createLLMOSWithStore`, logged on startup

### ActiveProcesses component
- New `ui/src/components/ActiveProcesses.tsx`
- Shows: header with worker progress count, elapsed time, thin progress bar, task rows with pulsing dots
- Self-manages visibility (returns null when no tasks and not loading)
- Uses 500ms tick interval for live elapsed times

### App.tsx integration
- Imported + rendered `<ActiveProcesses tasks={tasks} loading={loading} />` between SearchPanel and error/results

### Pulse animation
- Added `@keyframes pulse` CSS to `index.html` — fixes TaskTable + ActiveProcesses pulse dots

## 2026-03-02T14:34:02Z — UI redesign: Tailwind v4 + shadcn/ui

### Setup
- Installed: tailwindcss, clsx, tailwind-merge, class-variance-authority, lucide-react, non.geist + dev: @tailwindcss/vite, @types/node, tw-animate-css
- shadcn init generated: vite.config.ts (tailwind plugin + @ alias), components.json, lib/utils.ts (cn()), globals.css scaffold
- shadcn add: button, input, card, tabs, badge, progress, table → 7 files in src/components/ui/
- Used `non.geist` package for Geist fonts (the `geist` npm package only works with Next.js — no CSS exports)

### Theme (globals.css)
- Dark-only: applied .dark OKLch tokens directly on :root, removed light mode block
- Added Geist fonts via `@import "non.geist"` + `@import "non.geist/mono"` (font families: Geist-Variable, GeistMono-Variable)
- Custom semantic colors: --success, --warning, --info in OKLch
- Moved pulse keyframe from index.html → globals.css as `status-pulse`
- Base layer: body gets bg-background text-foreground

### Layout (App.tsx)
- Changed from single-column 960px to two-column: `max-w-7xl grid grid-cols-1 lg:grid-cols-[1fr_minmax(400px,45%)]`
- Left: SearchPanel + ActiveProcesses + results
- Right: shadcn Tabs (line variant) with Tasks/Store/AI Log/Usage panels
- Replaced hand-rolled tabs with shadcn Tabs/TabsList/TabsTrigger/TabsContent

### Component rewrites (all inline styles removed)
- SearchPanel: shadcn Input + Button with Search icon from lucide-react
- ActiveProcesses: Card + Progress component, task rows with Tailwind utility classes
- TaskTable: shadcn Table inside Card
- AILog: Card with expand/collapse using lucide ChevronRight/ChevronDown
- UsageSummary: Card + Tailwind bar chart (kept inline style only for data-driven widths)
- StoreExplorer: Card + Input + Tailwind tree (kept inline style only for dynamic depth padding)

### Cleanup
- Stripped `<style>` block from index.html
- Added `import "./globals.css"` to main.tsx
- Build succeeds: 265KB JS (82KB gzip), 37KB CSS (7KB gzip), fonts bundled as woff2

## 2026-03-02T16:21:03Z — Chat-with-History demo (M0-M5)

### M0: Project scaffolding
- Created `examples/chat-history/` with package.json, tsconfig.json
- Workspace glob `examples/*` auto-includes it — no pnpm-workspace.yaml change needed
- Created `src/types.ts` with all interfaces (ChatTurnEvent, SearchEvent, etc.)

### M1: History discovery
- Created `src/history.ts` — `readAllChatTurns(rawStore)` scans `/kernel/tasks/*/meta` for completed chat-turn tasks, reads request/response from `/task/{id}/request` and `/task/{id}/response`
- Uses raw store to avoid `list()` prefix stripping complexity
- 8 tests: empty store, discovery, chronological ordering, filters (name, status), missing data, excludeTaskIds, coexistence with other data

### M2: Search map-reduce
- Created `src/search.ts` — `searchCoordinatorTask` discovers turns, spawns `searchWorkerTask` per turn, synthesizes
- Created `src/mock-ai.ts` — MockAI with three behaviors: chat agent (with tool calls), search worker (keyword matching), search synthesis
- Fixed `findLast` → `filter + last element` for es2022 target
- 5 tests: empty history, relevant turn discovery, worker spawning, excludeTaskIds, AI logging

### M3: Chat turn with tool loop
- Created `src/chat.ts` — `chatTurnTask` with manual 3-round tool-use loop
- Created `src/search-tool.ts` — `createSearchHistoryTool(ctx)` factory (closure over TaskContext for ctx.spawn)
- Created `src/setup.ts` — `createChatLLMOS(mode, apiKey?, delayMs?)`
- 7 tests: simple turn, data storage, search trigger, session tracking, conversation history, createChatLLMOS mock/real

### M4: Interactive CLI
- Created `src/cli.ts` — readline-based interactive chat
- Features: /history, /inspect, /save, /quit commands
- Supports --real, --delay, --load flags
- ANSI colors for role labels
- Smoke tested: first turn works, history search triggered when loading previous snapshot
- Store snapshot shows full task tree: chat turns, coordinator, workers

### M5: Documentation
- Created README.md (quick start, how it works, CLI commands, store schema)
- Created DESIGN.md (architecture, data flow, tool loop, MockAI, key decisions, comparison with book-search)
- Updated scratch notes
