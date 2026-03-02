/**
 * Hono web server for the book search agent.
 *
 * Endpoints:
 *   POST /api/search  { query: string }  — run a search, return results
 *   GET  /api/state                      — return full store snapshot
 *   GET  /                               — health check / info
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  createLLMOSWithStore,
  loadBook,
  coordinatorTask,
} from "./agent.js";
import type { Store } from "llmos-v0";
import type { LLMOS } from "llmos-v0";

const EPUB_PATH =
  process.env.EPUB_PATH ||
  `${process.env.HOME}/Documents/books/the_hard_thing_about_hard_things.epub`;
const PORT = parseInt(process.env.PORT || "3000");
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "50000");
const MODE = (process.env.MODE || "mock") as "mock" | "real";
const MOCK_DELAY_MS = parseInt(process.env.MOCK_DELAY_MS || "1000");

// ─── Bootstrap ──────────────────────────────────────────────────────

let llmos: LLMOS;
let store: Store;
let bookLoaded = false;
let searchInProgress = false;

async function bootstrap() {
  console.log(`Mode: ${MODE}`);
  console.log(`Epub: ${EPUB_PATH}`);
  console.log(`Chunk size: ${CHUNK_SIZE}`);
  console.log(`Mock delay: ${MOCK_DELAY_MS}ms`);

  const system = createLLMOSWithStore(MODE, process.env.ANTHROPIC_API_KEY, MOCK_DELAY_MS);
  llmos = system.llmos;
  store = system.store;

  const globalStore = store.scope("/global/");
  console.log("Loading book...");
  const meta = await loadBook(EPUB_PATH, globalStore, CHUNK_SIZE);
  console.log(
    `Loaded: "${meta.title}" by ${meta.author} — ${meta.chunkCount} chunks`
  );
  bookLoaded = true;
}

// ─── App ────────────────────────────────────────────────────────────

const app = new Hono();

app.use("/*", cors());

app.get("/", (c) => {
  return c.json({
    name: "book-search",
    bookLoaded,
    searchInProgress,
    storeKeys: store ? Object.keys(store.snapshot()).length : 0,
  });
});

app.get("/api/state", (c) => {
  if (!store) {
    return c.json({ error: "Not initialized" }, 503);
  }
  return c.json(store.snapshot());
});

app.post("/api/search", async (c) => {
  if (!bookLoaded) {
    return c.json({ error: "Book not loaded yet" }, 503);
  }
  if (searchInProgress) {
    return c.json({ error: "Search already in progress" }, 409);
  }

  const body = await c.req.json<{ query: string }>();
  if (!body.query || typeof body.query !== "string") {
    return c.json({ error: "Missing 'query' field" }, 400);
  }

  searchInProgress = true;
  try {
    const handle = llmos.spawn(coordinatorTask, { query: body.query });
    const result = await handle.wait();

    if (!result.ok) {
      return c.json({ error: result.error.message }, 500);
    }

    return c.json({
      query: body.query,
      answer: result.value.answer,
      passages: result.value.passages,
      workerCount: result.value.workerCount,
    });
  } finally {
    searchInProgress = false;
  }
});

// ─── Start ──────────────────────────────────────────────────────────

await bootstrap();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`\nServer running at http://localhost:${info.port}`);
  console.log(`  POST /api/search  { "query": "..." }`);
  console.log(`  GET  /api/state`);
});
