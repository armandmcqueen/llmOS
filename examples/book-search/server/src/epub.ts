/**
 * EPUB extraction — adapted from armand.dev/packages/book-chat.
 * Converts an EPUB file to clean markdown text.
 */

import { Epub } from "@storyteller-platform/epub";
import TurndownService from "turndown";
import { readFile } from "fs/promises";

export interface ExtractionResult {
  title: string;
  author: string;
  content: string;
  wordCount: number;
  chapterCount: number;
}

/** Create a configured turndown instance for book content. */
function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    hr: "---",
  });

  td.addRule("removeImages", {
    filter: "img",
    replacement: () => "",
  });

  td.addRule("removeSvg", {
    filter: (node) => node.nodeName === "SVG" || node.nodeName === "svg",
    replacement: () => "",
  });

  td.addRule("stripInternalLinks", {
    filter: (node) => {
      if (node.nodeName !== "A") return false;
      const href = node.getAttribute("href") || "";
      return (
        href.endsWith(".xhtml") ||
        href.endsWith(".html") ||
        href.startsWith("#") ||
        (!href.startsWith("http://") && !href.startsWith("https://"))
      );
    },
    replacement: (_content, node) => {
      return (node as HTMLElement).textContent || "";
    },
  });

  return td;
}

/** Strip the XHTML <head> section to prevent <title> tags leaking into markdown. */
function stripXhtmlHead(xhtml: string): string {
  return xhtml.replace(/<head[\s>][\s\S]*?<\/head>/i, "");
}

/** Heuristic: returns true if a chunk looks like non-content (copyright, TOC, etc.). */
function isLikelyNonContent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 20) return true;

  const lower = trimmed.toLowerCase();

  if (
    lower.includes("all rights reserved") &&
    lower.includes("copyright") &&
    trimmed.length < 2000
  ) {
    return true;
  }

  if (
    lower.includes("isbn") &&
    !lower.includes("chapter") &&
    trimmed.length < 1000
  ) {
    return true;
  }

  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
  if (
    lines.length >= 3 &&
    (lower.startsWith("contents") ||
      lower.startsWith("table of contents")) &&
    trimmed.length < 3000
  ) {
    return true;
  }

  return false;
}

/** Clean up markdown: normalize whitespace. */
function cleanMarkdown(md: string): string {
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

/** Extract an EPUB file to markdown. */
export async function extractEpub(
  epubPath: string
): Promise<ExtractionResult> {
  const data = await readFile(epubPath);
  const epub = await Epub.from(new Uint8Array(data));
  const turndown = createTurndown();

  try {
    const title = (await epub.getTitle()) ?? "Unknown Title";
    const creators = await epub.getCreators();
    const author =
      creators.map((c) => c.name).join(", ") || "Unknown Author";

    const spineItems = await epub.getSpineItems();
    const chapters: string[] = [];

    for (const item of spineItems) {
      if (
        item.mediaType &&
        !item.mediaType.includes("xhtml") &&
        !item.mediaType.includes("html")
      ) {
        continue;
      }

      let xhtml: string;
      try {
        xhtml = await epub.readItemContents(item.id, "utf-8");
      } catch {
        continue;
      }

      const strippedXhtml = stripXhtmlHead(xhtml);
      const md = turndown.turndown(strippedXhtml);
      const cleaned = cleanMarkdown(md);

      if (cleaned && !isLikelyNonContent(cleaned)) {
        chapters.push(cleaned);
      }
    }

    const content = chapters.join("\n\n---\n\n");
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    return { title, author, content, wordCount, chapterCount: chapters.length };
  } finally {
    epub.discardAndClose();
  }
}

// CLI entry point: `npx tsx server/src/epub.ts <path-to-epub>`
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  main();
}

async function main() {
  const epubPath = process.argv[2];
  if (!epubPath) {
    console.error("Usage: npx tsx server/src/epub.ts <path-to-epub>");
    process.exit(1);
  }

  console.log(`Extracting: ${epubPath}`);
  const result = await extractEpub(epubPath);
  console.log(`Title: ${result.title}`);
  console.log(`Author: ${result.author}`);
  console.log(`Chapters: ${result.chapterCount}`);
  console.log(`Words: ${result.wordCount.toLocaleString()}`);
  console.log(`\nFirst 500 chars:\n${result.content.slice(0, 500)}`);
}
