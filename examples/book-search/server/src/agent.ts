/**
 * Book search agent — coordinator/worker pattern using llm-os.
 *
 * Flow:
 * 1. Coordinator receives a query
 * 2. Reads pre-loaded book chunks from global store
 * 3. Spawns worker tasks (one per chunk)
 * 4. Workers evaluate relevance via AI
 * 5. Coordinator synthesizes results via AI
 */

import {
  createLLMOS,
  defineTask,
  Store,
  createSpawner,
  ToolboxImpl,
  AIInterfaceImpl,
} from "llmos-v0";
import type {
  LLMOS,
  AIInterface,
  AIRequestParams,
  AIResponse,
  StoreAccessor,
  TaskDefinition,
  Handle,
  Result,
  TaskError,
} from "llmos-v0";
import { extractEpub } from "./epub.js";
import { chunkText } from "./chunk.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface WorkerEvent {
  chunkIndex: number;
  query: string;
}

export interface WorkerResult {
  chunkIndex: number;
  relevant: boolean;
  passages: string[];
  reasoning: string;
}

export interface CoordinatorEvent {
  query: string;
}

export interface CoordinatorResult {
  answer: string;
  passages: { chunkIndex: number; text: string }[];
  workerCount: number;
}

// ─── Task Definitions ───────────────────────────────────────────────

/** Handler shared by all worker tasks. */
async function workerHandler(
  ctx: import("llmos-v0").TaskContext,
  event: WorkerEvent
): Promise<WorkerResult> {
    const chunk = ctx.store.global.get(`chunks/${event.chunkIndex}`) as string;
    if (!chunk) {
      return {
        chunkIndex: event.chunkIndex,
        relevant: false,
        passages: [],
        reasoning: "Chunk not found",
      };
    }

    const response = await ctx.ai.request({
      system: `You are a book search assistant. Analyze the given passage and determine if it contains information relevant to the user's query. Respond with JSON: { "relevant": boolean, "passages": ["relevant quote 1", ...], "reasoning": "why or why not" }. Extract the most relevant direct quotes as passages. If not relevant, return empty passages array.`,
      messages: [
        {
          role: "user",
          content: `Query: "${event.query}"\n\nPassage:\n${chunk}`,
        },
      ],
      maxTokens: 1024,
    });

    // Parse the AI response
    try {
      const parsed = JSON.parse(response.content);
      return {
        chunkIndex: event.chunkIndex,
        relevant: Boolean(parsed.relevant),
        passages: Array.isArray(parsed.passages) ? parsed.passages : [],
        reasoning: parsed.reasoning || "",
      };
    } catch {
      // If AI didn't return valid JSON, try to extract meaning
      const isRelevant = response.content.toLowerCase().includes('"relevant": true') ||
        response.content.toLowerCase().includes('"relevant":true');
      return {
        chunkIndex: event.chunkIndex,
        relevant: isRelevant,
        passages: isRelevant ? [response.content.slice(0, 200)] : [],
        reasoning: "Failed to parse structured response",
      };
    }
}

/** Create a worker task with a numbered name. */
export function createWorkerTask(index: number) {
  return defineTask<WorkerEvent, WorkerResult>({
    name: `search-worker-${index}`,
    handler: workerHandler,
  });
}

export const coordinatorTask = defineTask<CoordinatorEvent, CoordinatorResult>({
  name: "search-coordinator",
  handler: async (ctx, event) => {
    // Store the query
    ctx.store.global.set("search/query", event.query);

    // Read chunk count from metadata
    const meta = ctx.store.global.get("book/meta") as {
      title: string;
      author: string;
      chunkCount: number;
    };
    if (!meta) {
      throw new Error("Book not loaded — call loadBook() first");
    }

    // Spawn workers for each chunk
    const handles: Handle<WorkerResult>[] = [];
    for (let i = 0; i < meta.chunkCount; i++) {
      const worker = createWorkerTask(i);
      handles.push(
        ctx.spawn(worker, { chunkIndex: i, query: event.query })
      );
    }

    // Wait for all workers
    const results = await Promise.all(handles.map((h) => h.wait()));

    // Collect relevant passages
    const relevantPassages: { chunkIndex: number; text: string }[] = [];
    for (const result of results) {
      if (result.ok && result.value.relevant) {
        for (const passage of result.value.passages) {
          relevantPassages.push({
            chunkIndex: result.value.chunkIndex,
            text: passage,
          });
        }
      }
    }

    // Synthesize final answer
    let answer: string;
    if (relevantPassages.length === 0) {
      answer =
        "No relevant passages found in the book for this query.";
    } else {
      const passageText = relevantPassages
        .map((p, i) => `[${i + 1}] (chunk ${p.chunkIndex}): ${p.text}`)
        .join("\n\n");

      const synthesisResponse = await ctx.ai.request({
        system: `You are a helpful book analysis assistant. Given relevant passages from "${meta.title}" by ${meta.author}, synthesize a coherent answer to the user's question. Reference specific passages. Be concise but thorough.`,
        messages: [
          {
            role: "user",
            content: `Question: "${event.query}"\n\nRelevant passages:\n${passageText}`,
          },
        ],
        maxTokens: 2048,
      });
      answer = synthesisResponse.content;
    }

    // Store results
    ctx.store.global.set("search/result", {
      query: event.query,
      answer,
      passageCount: relevantPassages.length,
    });

    return {
      answer,
      passages: relevantPassages,
      workerCount: meta.chunkCount,
    };
  },
});

// ─── Book Loading ───────────────────────────────────────────────────

/**
 * Load an epub into the global store, splitting into chunks.
 */
export async function loadBook(
  epubPath: string,
  globalStore: StoreAccessor,
  targetChunkSize = 2000
): Promise<{ title: string; author: string; chunkCount: number }> {
  const result = await extractEpub(epubPath);
  const chunks = chunkText(result.content, targetChunkSize);

  // Store full content
  globalStore.set("book/content", result.content);

  // Store chunks
  for (const chunk of chunks) {
    globalStore.set(`chunks/${chunk.index}`, chunk.text);
  }

  // Store metadata
  const meta = {
    title: result.title,
    author: result.author,
    chunkCount: chunks.length,
    wordCount: result.wordCount,
    chapterCount: result.chapterCount,
  };
  globalStore.set("book/meta", meta);

  return meta;
}

// ─── Mock AI for Testing ────────────────────────────────────────────

/**
 * Creates a mock AI interface that returns predetermined responses.
 * Used for CLI testing without real API calls.
 */
class MockAI implements AIInterface {
  private kernelStore: StoreAccessor;
  private taskId: string | null;
  private delayMs: number;

  constructor(kernelStore: StoreAccessor, taskId?: string, delayMs = 0) {
    this.kernelStore = kernelStore;
    this.taskId = taskId ?? null;
    this.delayMs = delayMs;
  }

  forTask(taskId: string): MockAI {
    return new MockAI(this.kernelStore, taskId, this.delayMs);
  }

  async request(params: AIRequestParams): Promise<AIResponse> {
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    const startTime = Date.now();
    const content = this.generateMockResponse(params);

    const response: AIResponse = {
      content,
      toolCalls: [],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      raw: null,
    };

    const durationMs = Date.now() - startTime;

    // Log like the real AI
    this.kernelStore.append("ai/requests", {
      model: "mock",
      request: {
        system: params.system,
        messages: params.messages,
        tools: [],
      },
      response: {
        content: response.content,
        toolCalls: [],
        usage: response.usage,
      },
      durationMs,
      timestamp: new Date().toISOString(),
      taskId: this.taskId,
    });

    // Track usage
    if (this.taskId) {
      const usageKey = `tasks/${this.taskId}/usage`;
      const current = this.kernelStore.get(usageKey) ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      };
      this.kernelStore.set(usageKey, {
        promptTokens: current.promptTokens + response.usage.promptTokens,
        completionTokens:
          current.completionTokens + response.usage.completionTokens,
        totalTokens: current.totalTokens + response.usage.totalTokens,
        requestCount: current.requestCount + 1,
      });
    }

    return response;
  }

  private generateMockResponse(params: AIRequestParams): string {
    const userMsg =
      params.messages.find((m) => m.role === "user")?.content || "";

    // Worker response — search for keywords in the passage
    if (params.system?.includes("book search assistant")) {
      const queryMatch = userMsg.match(/Query: "(.+?)"/);
      const query = queryMatch?.[1]?.toLowerCase() || "";
      const passage = userMsg.split("Passage:\n")[1] || "";
      const passageLower = passage.toLowerCase();

      // Simple keyword matching for mock
      const queryWords = query.split(/\s+/).filter((w) => w.length > 3);
      const matches = queryWords.filter((w) => passageLower.includes(w));
      const relevant = matches.length > 0;

      if (relevant) {
        // Extract a short snippet around the first match
        const idx = passageLower.indexOf(matches[0]);
        const start = Math.max(0, idx - 50);
        const end = Math.min(passage.length, idx + 150);
        const snippet = passage.slice(start, end).trim();

        return JSON.stringify({
          relevant: true,
          passages: [snippet],
          reasoning: `Contains keywords: ${matches.join(", ")}`,
        });
      }

      return JSON.stringify({
        relevant: false,
        passages: [],
        reasoning: "No relevant keywords found",
      });
    }

    // Synthesis response
    if (params.system?.includes("book analysis assistant")) {
      const passages = userMsg.split("\n\n").filter((l) => l.startsWith("["));
      return `Based on ${passages.length} relevant passages from the book, here is a synthesis of the findings:\n\n${passages.map((p) => `- ${p.slice(0, 100)}...`).join("\n")}\n\nThese passages collectively address the query.`;
    }

    return "Mock response";
  }
}

/**
 * Create an LLMOS instance with mock AI for testing.
 */
export function createMockLLMOS(): LLMOS {
  const store = new Store();
  const kernelStore = store.scope("/kernel/");
  const toolbox = new ToolboxImpl(kernelStore);
  const mockAI = new MockAI(kernelStore);
  // createSpawner expects AIInterfaceImpl but MockAI is structurally compatible
  const spawn = createSpawner(store, mockAI as any, toolbox);

  return {
    store: { kernel: kernelStore },
    toolbox,
    defineTask,
    spawn,
  };
}

/**
 * Access the raw store for the state endpoint.
 * Returns a Store instance alongside the LLMOS.
 */
export function createLLMOSWithStore(
  mode: "mock" | "real",
  apiKey?: string,
  delayMs = 0
): { llmos: LLMOS; store: Store } {
  const store = new Store();
  const kernelStore = store.scope("/kernel/");
  const toolbox = new ToolboxImpl(kernelStore);

  let ai: any;
  if (mode === "mock") {
    ai = new MockAI(kernelStore, undefined, delayMs);
  } else {
    ai = new AIInterfaceImpl(
      {
        provider: "anthropic",
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY || "",
        defaultModel: "claude-sonnet-4-20250514",
      },
      kernelStore
    );
  }

  const spawn = createSpawner(store, ai, toolbox);

  const llmos: LLMOS = {
    store: { kernel: kernelStore },
    toolbox,
    defineTask,
    spawn,
  };

  return { llmos, store };
}

// ─── CLI Entry Point ────────────────────────────────────────────────

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  runMockDemo();
}

async function runMockDemo() {
  const epubPath =
    process.argv[2] ||
    `${process.env.HOME}/Documents/books/the_hard_thing_about_hard_things.epub`;
  const query = process.argv[3] || "leadership lessons";

  console.log("=== Book Search Agent — Mock Demo ===\n");

  // Create mock LLMOS with accessible store
  const { llmos, store } = createLLMOSWithStore("mock");
  const globalStore = store.scope("/global/");

  // Load book
  console.log(`Loading book: ${epubPath}`);
  const meta = await loadBook(epubPath, globalStore, 50_000);
  console.log(
    `Loaded: "${meta.title}" by ${meta.author} — ${meta.chunkCount} chunks\n`
  );

  // Run search
  console.log(`Searching for: "${query}"`);
  console.log("Spawning coordinator...\n");

  const handle = llmos.spawn(coordinatorTask, { query });
  const result = await handle.wait();

  if (!result.ok) {
    console.error("Search failed:", result.error.message);
    process.exit(1);
  }

  // Print results
  console.log("=== Results ===\n");
  console.log(`Workers: ${result.value.workerCount}`);
  console.log(`Relevant passages: ${result.value.passages.length}\n`);
  console.log("Answer:");
  console.log(result.value.answer);

  // Print store state summary
  console.log("\n=== Store State ===\n");
  const raw = store.raw();
  const allKeys = raw.list();
  console.log(`Total keys: ${allKeys.length}`);

  // Group by namespace
  const namespaces: Record<string, number> = {};
  for (const key of allKeys) {
    const ns = key.split("/").slice(0, 2).join("/") + "/";
    namespaces[ns] = (namespaces[ns] || 0) + 1;
  }
  console.log("Namespaces:");
  for (const [ns, count] of Object.entries(namespaces).sort()) {
    console.log(`  ${ns}: ${count} keys`);
  }

  // Task metadata
  const taskKeys = raw.list("/kernel/tasks/");
  const metaKeys = taskKeys.filter((k) => k.endsWith("/meta"));
  console.log(`\nTasks: ${metaKeys.length}`);
  for (const key of metaKeys) {
    const m = raw.get(key);
    console.log(
      `  ${m.name} [${m.status}] — ${m.parentId ? "child of " + m.parentId.slice(0, 8) : "root"}`
    );
  }

  // AI request logs
  const aiRequests = raw.get("/kernel/ai/requests") || [];
  console.log(`\nAI Requests: ${aiRequests.length}`);
  for (const req of aiRequests.slice(0, 5)) {
    console.log(
      `  [${req.model}] task=${req.taskId?.slice(0, 8) || "none"} ${req.durationMs}ms`
    );
  }
  if (aiRequests.length > 5) {
    console.log(`  ... and ${aiRequests.length - 5} more`);
  }

  // Dump snapshot to disk
  const { writeFile } = await import("fs/promises");
  const snapshotPath = "store-snapshot.json";
  await writeFile(snapshotPath, JSON.stringify(store.snapshot(), null, 2));
  console.log(`\nSnapshot written to: ${snapshotPath}`);
  console.log(`Inspect with: npx tsx server/src/store-cli.ts ${snapshotPath}`);
}
