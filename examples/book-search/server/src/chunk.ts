/**
 * Text chunking — splits markdown into ~targetSize character chunks
 * on paragraph boundaries.
 */

export interface Chunk {
  index: number;
  text: string;
  charCount: number;
}

/**
 * Split text into chunks of approximately `targetSize` characters,
 * breaking on paragraph boundaries (double newlines).
 */
export function chunkText(text: string, targetSize = 2000): Chunk[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let current = "";

  for (const para of paragraphs) {
    // If adding this paragraph would exceed target and we have content, flush
    if (current.length > 0 && current.length + para.length + 2 > targetSize) {
      chunks.push({
        index: chunks.length,
        text: current.trim(),
        charCount: current.trim().length,
      });
      current = "";
    }
    current += (current ? "\n\n" : "") + para;
  }

  // Flush remaining
  if (current.trim()) {
    chunks.push({
      index: chunks.length,
      text: current.trim(),
      charCount: current.trim().length,
    });
  }

  return chunks;
}
