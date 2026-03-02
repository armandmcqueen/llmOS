# initial_build — State

## Current Status
All milestones (M0–M5) complete. llm-os v0.1 is fully implemented and tested.

## Milestones
- [x] M0: Project Setup (build + test infra)
- [x] M1: Store
- [x] M2: Toolbox
- [x] M3: AI Interface
- [x] M4: Tasks
- [x] M5: Integration + Entry Point

## Key Files
- `src/index.ts` — `createLLMOS` factory + public API exports
- `src/types.ts` — All shared interfaces
- `src/store.ts` — Store class with scope()/raw()
- `src/toolbox.ts` — ToolboxImpl
- `src/ai.ts` — AIInterfaceImpl (wraps Vercel AI SDK generateText)
- `src/task.ts` — defineTask, createSpawner, ephemeral cleanup

## Test Counts (72 total)
- store: 18
- toolbox: 15
- ai: 14
- task: 20
- integration: 5

## Demo Scripts
- `npx tsx src/__demo__/store-demo.ts`
- `npx tsx src/__demo__/toolbox-demo.ts`
- `npx tsx src/__demo__/ai-demo.ts`
- `npx tsx src/__demo__/task-demo.ts`
- `npx tsx src/__demo__/full-demo.ts`

## Known Issues
- Demo scripts need `async function main()` wrapper — tsx doesn't support top-level await in CJS mode
