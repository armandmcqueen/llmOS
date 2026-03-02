#!/usr/bin/env npx tsx
/**
 * Book Search CLI — single entry point for all commands.
 */

import { Command } from "commander";
import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { Store } from "llmos-v0";
import { extractEpub } from "./epub.js";
import {
  createLLMOSWithStore,
  loadBook,
  coordinatorTask,
} from "./agent.js";

const DEFAULT_EPUB = `${process.env.HOME}/Documents/books/the_hard_thing_about_hard_things.epub`;

const program = new Command();
program
  .name("book-search")
  .description("Book search agent demo — epub extraction, search, and state inspection")
  .version("0.1.0");

// ─── extract ────────────────────────────────────────────────────────

program
  .command("extract")
  .description("Extract an epub to markdown and print stats")
  .argument("[epub]", "Path to epub file", DEFAULT_EPUB)
  .action(async (epubPath: string) => {
    console.log(`Extracting: ${epubPath}`);
    const result = await extractEpub(epubPath);
    console.log(`Title: ${result.title}`);
    console.log(`Author: ${result.author}`);
    console.log(`Chapters: ${result.chapterCount}`);
    console.log(`Words: ${result.wordCount.toLocaleString()}`);
    console.log(`\nFirst 500 chars:\n${result.content.slice(0, 500)}`);
  });

// ─── search ─────────────────────────────────────────────────────────

program
  .command("search")
  .description("Run a mock book search and save store snapshot")
  .argument("<query>", "Search query")
  .argument("[epub]", "Path to epub file", DEFAULT_EPUB)
  .option("-o, --output <file>", "Snapshot output path", "store-snapshot.json")
  .option("--chunk-size <n>", "Target chunk size in characters", "50000")
  .action(async (query: string, epubPath: string, opts: { output: string; chunkSize: string }) => {
    console.log("=== Book Search Agent — Mock Demo ===\n");

    const { llmos, store } = createLLMOSWithStore("mock");
    const globalStore = store.scope("/global/");

    console.log(`Loading book: ${epubPath}`);
    const meta = await loadBook(epubPath, globalStore, parseInt(opts.chunkSize));
    console.log(`Loaded: "${meta.title}" by ${meta.author} — ${meta.chunkCount} chunks\n`);

    console.log(`Searching for: "${query}"`);
    console.log("Spawning coordinator...\n");

    const handle = llmos.spawn(coordinatorTask, { query });
    const result = await handle.wait();

    if (!result.ok) {
      console.error("Search failed:", result.error.message);
      process.exit(1);
    }

    console.log("=== Results ===\n");
    console.log(`Workers: ${result.value.workerCount}`);
    console.log(`Relevant passages: ${result.value.passages.length}\n`);
    console.log("Answer:");
    console.log(result.value.answer);

    // Summary
    const raw = store.raw();
    const allKeys = raw.list();
    const taskMetas = raw.list("/kernel/tasks/").filter((k) => k.endsWith("/meta"));
    const aiRequests = raw.get("/kernel/ai/requests") || [];
    console.log(`\n=== Store: ${allKeys.length} keys, ${taskMetas.length} tasks, ${aiRequests.length} AI requests ===`);

    await writeFile(opts.output, JSON.stringify(store.snapshot(), null, 2));
    console.log(`\nSnapshot written to: ${opts.output}`);
  });

// ─── inspect ────────────────────────────────────────────────────────

const inspect = program
  .command("inspect")
  .description("Inspect a store snapshot")
  .option("-f, --file <file>", "Snapshot JSON file", "store-snapshot.json");

inspect
  .command("summary")
  .description("Show namespace summary")
  .action(async (_opts: unknown, cmd: Command) => {
    const file = cmd.parent!.opts().file;
    const snapshot = await loadJSON(file);
    const keys = Object.keys(snapshot);
    console.log(`Total keys: ${keys.length}\n`);

    const namespaces: Record<string, number> = {};
    for (const key of keys) {
      const parts = key.split("/").filter(Boolean);
      const ns = parts.length > 0 ? `/${parts[0]}/` : "/";
      namespaces[ns] = (namespaces[ns] || 0) + 1;
    }
    console.log("Namespaces:");
    for (const [ns, count] of Object.entries(namespaces).sort()) {
      console.log(`  ${ns.padEnd(20)} ${count} keys`);
    }
  });

inspect
  .command("ls")
  .description("List keys with type annotations")
  .argument("[prefix]", "Filter by key prefix")
  .action(async (prefix: string | undefined, _opts: unknown, cmd: Command) => {
    const file = cmd.parent!.opts().file;
    const snapshot = await loadJSON(file);
    const keys = Object.keys(snapshot)
      .filter((k) => !prefix || k.startsWith(prefix))
      .sort();

    if (keys.length === 0) {
      console.log(prefix ? `No keys matching: ${prefix}` : "Store is empty");
      return;
    }
    for (const key of keys) {
      console.log(`  ${key}  →  ${describeValue(snapshot[key])}`);
    }
    console.log(`\n${keys.length} keys`);
  });

inspect
  .command("tree")
  .description("Show keys as an indented directory tree")
  .argument("[prefix]", "Filter by key prefix")
  .action(async (prefix: string | undefined, _opts: unknown, cmd: Command) => {
    const file = cmd.parent!.opts().file;
    const snapshot = await loadJSON(file);
    const keys = Object.keys(snapshot)
      .filter((k) => !prefix || k.startsWith(prefix))
      .sort();

    if (keys.length === 0) {
      console.log(prefix ? `No keys matching: ${prefix}` : "Store is empty");
      return;
    }

    interface TreeNode {
      children: Map<string, TreeNode>;
      value?: any;
      fullKey?: string;
    }

    const root: TreeNode = { children: new Map() };
    for (const key of keys) {
      const parts = key.split("/").filter(Boolean);
      let node = root;
      for (const part of parts) {
        if (!node.children.has(part)) {
          node.children.set(part, { children: new Map() });
        }
        node = node.children.get(part)!;
      }
      node.value = snapshot[key];
      node.fullKey = key;
    }

    function printNode(node: TreeNode, indent: string, isLast: boolean, name?: string): void {
      if (name !== undefined) {
        const connector = isLast ? "└── " : "├── ";
        const suffix = node.fullKey !== undefined ? `  →  ${describeValue(node.value)}` : "";
        console.log(`${indent}${connector}${name}${suffix}`);
      }
      const childIndent = name !== undefined ? indent + (isLast ? "    " : "│   ") : indent;
      const entries = Array.from(node.children.entries());
      for (let i = 0; i < entries.length; i++) {
        printNode(entries[i][1], childIndent, i === entries.length - 1, entries[i][0]);
      }
    }

    printNode(root, "", true);
    console.log(`\n${keys.length} keys`);
  });

inspect
  .command("get")
  .description("Print the value at a specific key")
  .argument("<path>", "Store key path")
  .action(async (path: string, _opts: unknown, cmd: Command) => {
    const file = cmd.parent!.opts().file;
    const snapshot = await loadJSON(file);
    const key = path in snapshot ? path : path.startsWith("/") ? path : `/${path}`;
    if (!(key in snapshot)) {
      console.error(`Key not found: ${path}`);
      process.exit(1);
    }
    console.log(JSON.stringify(snapshot[key], null, 2));
  });

inspect
  .command("dump")
  .description("Write snapshot to a directory tree on disk")
  .argument("[dir]", "Output directory", "store-tree")
  .action(async (outputDir: string, _opts: unknown, cmd: Command) => {
    const file = cmd.parent!.opts().file;
    const snapshot = await loadJSON(file);
    const keys = Object.keys(snapshot).sort();
    let fileCount = 0;

    for (const key of keys) {
      const relPath = key.replace(/^\//, "");
      const filePath = resolve(outputDir, relPath + ".json");
      await mkdir(dirname(filePath), { recursive: true });
      const value = snapshot[key];
      const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      await writeFile(filePath, content, "utf-8");
      fileCount++;
    }

    console.log(`Wrote ${fileCount} files to: ${outputDir}/`);
    console.log(`\nBrowse with:`);
    console.log(`  ls ${outputDir}/`);
    console.log(`  find ${outputDir} -name '*.json' | head -20`);
    console.log(`  cat ${outputDir}/kernel/tasks/*/meta.json`);
  });

inspect
  .command("load")
  .description("Verify round-trip: load snapshot into an llmos Store")
  .action(async (_opts: unknown, cmd: Command) => {
    const file = cmd.parent!.opts().file;
    const snapshot = await loadJSON(file);
    const store = new Store();
    store.load(snapshot);

    const reSnapshot = store.snapshot();
    const origKeys = Object.keys(snapshot).sort();
    const reKeys = Object.keys(reSnapshot).sort();

    if (origKeys.length !== reKeys.length) {
      console.error(`Key count mismatch: ${origKeys.length} vs ${reKeys.length}`);
      process.exit(1);
    }

    const kernel = store.scope("/kernel/");
    const taskMetas = kernel.list("tasks/").filter((k: string) => k.endsWith("/meta"));
    const global = store.scope("/global/");
    const bookMeta = global.get("book/meta");

    console.log(`Loaded ${origKeys.length} keys into Store`);
    console.log(`  Tasks: ${taskMetas.length}`);
    if (bookMeta) {
      console.log(`  Book: "${bookMeta.title}" by ${bookMeta.author}`);
    }
    console.log(`  Round-trip: OK`);
  });

// ─── Helpers ────────────────────────────────────────────────────────

async function loadJSON(path: string): Promise<Record<string, any>> {
  const data = await readFile(path, "utf-8");
  return JSON.parse(data);
}

function describeValue(val: any): string {
  if (Array.isArray(val)) return `array[${val.length}]`;
  if (typeof val === "object" && val !== null)
    return `object{${Object.keys(val).length}}`;
  if (typeof val === "string")
    return val.length > 80 ? `string(${val.length} chars)` : `"${val}"`;
  return String(val);
}

// ─── Run ────────────────────────────────────────────────────────────

program.parse();
