/**
 * Find the split point between stable (completed) and streaming (in-progress)
 * markdown content for incremental rendering.
 *
 * During streaming, text only grows. Once a block element is followed by a
 * blank line (`\n\n`), its markdown source never changes. This function finds
 * the last such boundary before `revealPosition` so that everything before it
 * can be parsed once and memoized, while only the last partial block needs
 * per-frame re-parsing.
 *
 * The scan is fence-aware: `\n\n` inside a fenced code block (``` or ~~~) is
 * NOT treated as a block boundary.
 */

const FENCE_RE = /^[ ]{0,3}(`{3,}|~{3,})/;

export function findBlockSplitPoint(
  text: string,
  revealPosition: number,
): number {
  const end = Math.min(revealPosition, text.length);
  let splitIndex = 0;
  let inFence = false;
  let fenceChar = '';
  let fenceCount = 0;
  let lineStart = 0;

  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      const line = text.slice(lineStart, i);
      const match = FENCE_RE.exec(line);
      if (match) {
        const marker = match[1];
        const ch = marker[0];
        const count = marker.length;

        if (!inFence) {
          inFence = true;
          fenceChar = ch;
          fenceCount = count;
        } else if (ch === fenceChar && count >= fenceCount) {
          inFence = false;
        }
      }

      if (!inFence && i + 1 < end && text[i + 1] === '\n') {
        splitIndex = i + 2;
      }

      lineStart = i + 1;
    }
  }

  return splitIndex;
}
