/**
 * CLI for inspecting llmos store snapshots.
 *
 * Usage:
 *   npx tsx server/src/store-cli.ts <snapshot.json> [command] [args...]
 *
 * Commands:
 *   (no command)     Show summary of namespaces and key counts
 *   ls [prefix]      List keys, optionally filtered by prefix
 *   tree [prefix]    Show keys as an indented directory tree
 *   get <path>       Print the value at a specific key
 *   dump [dir]       Write snapshot to a directory tree on disk (default: ./store-tree)
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { Store } from "llmos-v0";

interface Snapshot {
  [key: string]: any;
}

async function loadSnapshot(path: string): Promise<Snapshot> {
  const data = await readFile(path, "utf-8");
  return JSON.parse(data);
}

function summarize(snapshot: Snapshot): void {
  const keys = Object.keys(snapshot);
  console.log(`Total keys: ${keys.length}\n`);

  // Group by top-level namespace
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
}

function listKeys(snapshot: Snapshot, prefix?: string): void {
  const keys = Object.keys(snapshot)
    .filter((k) => !prefix || k.startsWith(prefix))
    .sort();

  if (keys.length === 0) {
    console.log(prefix ? `No keys matching: ${prefix}` : "Store is empty");
    return;
  }

  for (const key of keys) {
    const val = snapshot[key];
    const type = describeValue(val);
    console.log(`  ${key}  →  ${type}`);
  }
  console.log(`\n${keys.length} keys`);
}

function describeValue(val: any): string {
  if (Array.isArray(val)) return `array[${val.length}]`;
  if (typeof val === "object" && val !== null)
    return `object{${Object.keys(val).length}}`;
  if (typeof val === "string")
    return val.length > 80 ? `string(${val.length} chars)` : `"${val}"`;
  return String(val);
}

function showTree(snapshot: Snapshot, prefix?: string): void {
  const keys = Object.keys(snapshot)
    .filter((k) => !prefix || k.startsWith(prefix))
    .sort();

  if (keys.length === 0) {
    console.log(prefix ? `No keys matching: ${prefix}` : "Store is empty");
    return;
  }

  // Build a nested structure from paths
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

  // Print tree with indentation
  function printNode(node: TreeNode, indent: string, isLast: boolean, name?: string): void {
    if (name !== undefined) {
      const connector = isLast ? "└── " : "├── ";
      const valueSuffix = node.fullKey !== undefined ? `  →  ${describeValue(node.value)}` : "";
      console.log(`${indent}${connector}${name}${valueSuffix}`);
    }

    const childIndent = name !== undefined ? indent + (isLast ? "    " : "│   ") : indent;
    const entries = Array.from(node.children.entries());

    for (let i = 0; i < entries.length; i++) {
      const [childName, childNode] = entries[i];
      const childIsLast = i === entries.length - 1;
      printNode(childNode, childIndent, childIsLast, childName);
    }
  }

  printNode(root, "", true);
  console.log(`\n${keys.length} keys`);
}

function getValue(snapshot: Snapshot, path: string): void {
  if (!(path in snapshot)) {
    const withSlash = path.startsWith("/") ? path : `/${path}`;
    if (withSlash in snapshot) {
      console.log(JSON.stringify(snapshot[withSlash], null, 2));
      return;
    }
    console.error(`Key not found: ${path}`);
    console.error(`Try: ls to see available keys`);
    process.exit(1);
  }
  console.log(JSON.stringify(snapshot[path], null, 2));
}

async function dumpTree(
  snapshot: Snapshot,
  outputDir: string
): Promise<void> {
  const keys = Object.keys(snapshot).sort();
  let fileCount = 0;

  for (const key of keys) {
    const relPath = key.replace(/^\//, "");
    const filePath = resolve(outputDir, relPath + ".json");

    await mkdir(dirname(filePath), { recursive: true });

    const value = snapshot[key];
    const content =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    await writeFile(filePath, content, "utf-8");
    fileCount++;
  }

  console.log(`Wrote ${fileCount} files to: ${outputDir}/`);
  console.log(`\nBrowse with:`);
  console.log(`  ls ${outputDir}/`);
  console.log(`  find ${outputDir} -name '*.json' | head -20`);
  console.log(`  cat ${outputDir}/kernel/tasks/*/meta.json`);
}

/**
 * Load a snapshot JSON file from disk into an llmos Store.
 * This is the disk→memory path: readFile + JSON.parse + store.load().
 */
export async function loadSnapshotFromDisk(path: string): Promise<Store> {
  const data = await readFile(path, "utf-8");
  const snapshot = JSON.parse(data);
  const store = new Store();
  store.load(snapshot);
  return store;
}

function verifyLoad(snapshot: Snapshot): void {
  const store = new Store();
  store.load(snapshot);

  const reSnapshot = store.snapshot();
  const origKeys = Object.keys(snapshot).sort();
  const reKeys = Object.keys(reSnapshot).sort();

  if (origKeys.length !== reKeys.length) {
    console.error(
      `Key count mismatch: ${origKeys.length} vs ${reKeys.length}`
    );
    process.exit(1);
  }

  // Verify a few values through scoped accessors
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
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      "Usage: npx tsx server/src/store-cli.ts <snapshot.json> [command] [args...]"
    );
    console.log("");
    console.log("Commands:");
    console.log("  (none)          Summary of namespaces and key counts");
    console.log("  ls [prefix]     List keys, optionally filtered by prefix");
    console.log("  tree [prefix]   Show keys as an indented directory tree");
    console.log("  get <path>      Print value at a specific key");
    console.log(
      "  dump [dir]      Write to directory tree on disk (default: ./store-tree)"
    );
    console.log("  load            Load into an llmos Store and verify round-trip");
    process.exit(0);
  }

  const snapshotPath = args[0];
  const command = args[1] || "summary";
  const snapshot = await loadSnapshot(snapshotPath);

  switch (command) {
    case "summary":
      summarize(snapshot);
      break;
    case "ls":
      listKeys(snapshot, args[2]);
      break;
    case "tree":
      showTree(snapshot, args[2]);
      break;
    case "get":
      if (!args[2]) {
        console.error("Usage: get <path>");
        process.exit(1);
      }
      getValue(snapshot, args[2]);
      break;
    case "dump":
      await dumpTree(snapshot, args[2] || "store-tree");
      break;
    case "load":
      verifyLoad(snapshot);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main();
