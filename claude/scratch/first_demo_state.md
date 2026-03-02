# first_demo branch — State

## Goal
Build a book-search agent demo: epub → chunks → map-reduce search → web UI visualization.

## Current Status
UI redesign complete — migrated from inline styles to Tailwind v4 + shadcn/ui. Two-column layout, light theme matching armandmcqueen.dev (white bg, teal/green accents, OKLch), Geist fonts. Build passes. Needs visual verification in browser.

## Milestones
- **M0** ✅ Workspace + epub extraction
- **M1** ✅ Chunking + agent logic (mock AI, 10 workers)
- **M2** ✅ Web server + API
- **M3** ✅ React UI — scaffold + search
- **M4** ✅ Visualization panels
- **UI Redesign** ✅ Tailwind v4 + shadcn/ui migration

## Key Files

### Root (llmos-v0 core — modified)
- `package.json` — added `"type": "module"`, changed main to `src/index.ts`
- `src/index.ts` — added exports: `Store`, `createSpawner`, `ToolboxImpl`, `AIInterfaceImpl`
- `src/store.ts` — added `snapshot()` and `load()` methods
- `pnpm-workspace.yaml` — workspace config for pnpm (not package.json workspaces)

### Example (`examples/book-search/`)
- `package.json` — deps: llmos-v0, epub, turndown, hono, commander
- `tsconfig.json`
- `server/src/epub.ts` — epub extraction (adapted from armand.dev)
- `server/src/chunk.ts` — paragraph-boundary chunking
- `server/src/agent.ts` — coordinator/worker tasks, MockAI, `createLLMOSWithStore()`, `loadBook()`
- `server/src/server.ts` — Hono server (POST /api/search, GET /api/state)
- `server/src/cli.ts` — Commander CLI: `search`, `extract`, `inspect` subcommands
- `server/src/store-cli.ts` — Standalone store inspection (predates cli.ts, still works)
- `store-snapshot.json` — last mock run output

### UI (`examples/book-search/ui/`)
- `package.json` — react, tailwindcss, shadcn deps, non.geist, lucide-react
- `vite.config.ts` — @tailwindcss/vite plugin, @ path alias, /api proxy
- `tsconfig.json` — baseUrl + paths for @ alias
- `components.json` — shadcn config (new-york, no rsc, neutral)
- `src/globals.css` — Tailwind v4 + shadcn tokens, dark-only OKLch, Geist fonts via non.geist, custom --success/--warning/--info colors, status-pulse keyframe
- `src/lib/utils.ts` — cn() utility (clsx + tailwind-merge)
- `src/components/ui/` — shadcn: button, input, card, tabs, badge, progress, table
- `src/App.tsx` — two-column grid layout, shadcn Tabs for debug panels
- `src/components/SearchPanel.tsx` — shadcn Input + Button
- `src/components/ActiveProcesses.tsx` — Card + Progress, task rows with Tailwind
- `src/components/TaskTable.tsx` — shadcn Table inside Card
- `src/components/AILog.tsx` — Card + expand/collapse with lucide icons
- `src/components/UsageSummary.tsx` — Card + Tailwind bar chart (inline style for data-driven widths)
- `src/components/StoreExplorer.tsx` — Card + Input + Tailwind tree (inline style for dynamic depth padding)
- `src/useStoreState.ts` — polling hook + data extraction helpers (unchanged)

## Key Design Decisions
- Workers are numbered: `search-worker-0`, `search-worker-1`, etc.
- Default 10 workers (50K char chunks) for demo, configurable via `--chunk-size`
- MockAI does keyword matching — no API costs for testing
- Store serialization: `store.snapshot()` → JSON → `store.load()` round-trip
- `pnpm cli` is the main entry point (commander-based)
- `pnpm cli inspect` subcommands default to `store-snapshot.json`
- Dark-only theme — no light mode toggle, .dark tokens applied directly on :root
- `non.geist` package for Geist fonts (the `geist` npm package is Next.js-only)
- Custom semantic colors: --success (green), --warning (amber), --info (blue) in OKLch
- Two-column layout: search+results left, debug tabs right (max-w-7xl)
- Inline styles kept only for data-driven values (bar widths, tree depth padding)

## Known Issues
- Old standalone CLIs (epub.ts, agent.ts, store-cli.ts) still have raw process.argv entry points — could be cleaned up but still functional
- Needs visual testing in browser to verify layout + colors look correct
