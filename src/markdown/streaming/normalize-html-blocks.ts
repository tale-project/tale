/**
 * normalizeHtmlBlocks — auto-insert blank lines around block-level HTML tags
 * so markdown inside is parsed.
 *
 * CommonMark type-6 HTML blocks (any block-level tag at the start of a line)
 * swallow all subsequent lines as raw HTML until a blank line is reached. So
 *
 *   <div align="center">
 *   ⭐ **活化石** | 🌍 **世界自然基金会标志**
 *   </div>
 *
 * renders the `**` literally because the entire 3-line region is one HTML
 * block and markdown is never parsed inside it. Inserting blank lines turns it
 * into three separate blocks (the open tag, the markdown paragraph, the close
 * tag) and the bold renders correctly.
 *
 * Skipped contexts (do NOT insert anything):
 *   - Inside fenced code blocks (``` or ~~~) — content is raw, must stay verbatim
 *   - Inline tags like <span>, <a> — only block-level tags trigger HTML blocks
 *
 * Idempotent: text that already has blank lines around its block tags is
 * returned unchanged.
 */

// CommonMark spec § 4.6 HTML blocks, condition 6: full list of block-level
// HTML tag names that open a type-6 HTML block.
const BLOCK_HTML_TAGS = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'section',
  'source',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
]);

// Match a tag name at the very start of a line (after up to 3 spaces of
// indentation, per CommonMark). Captures direction (`/` for closing) and tag.
// Trailing context must be space, `>`, `/>`, or end-of-line — matches the
// HTML block start condition exactly so we don't mistake `<divider>` for
// `<div>`.
const TAG_LINE_RE = /^\s{0,3}<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(\s|>|\/>|$)/;

const FENCE_OPEN_RE = /^\s{0,3}(```+|~~~+)/;

function isBlockTagLine(
  line: string,
): { tag: string; isClose: boolean } | null {
  const m = line.match(TAG_LINE_RE);
  if (!m) return null;
  const tag = m[2].toLowerCase();
  if (!BLOCK_HTML_TAGS.has(tag)) return null;
  return { tag, isClose: m[1] === '/' };
}

export function normalizeHtmlBlocks(text: string): string {
  return normalizeHtmlBlocksWithOffsets(text).text;
}

export interface NormalizedHtmlBlocks {
  text: string;
  /**
   * Where the blank lines went: the offset in `text` of each newline that was
   * added, ascending. Everything else in `text` is the input, in order, so an
   * offset of `text` maps back to the input by subtracting how many of these
   * lie before it (`toInputOffset`).
   */
  inserted: number[];
}

/** {@link normalizeHtmlBlocks}, telling where it inserted, so a reader that
 * parses the result can point back into the text it was given. */
export function normalizeHtmlBlocksWithOffsets(
  text: string,
): NormalizedHtmlBlocks {
  // Cheap pre-check — most messages contain no HTML at all.
  if (!text || !text.includes('<')) return { text, inserted: [] };

  const lines = text.split('\n');
  const out: string[] = [];
  const inserted: number[] = [];
  // Length of `out.join('\n')` so far.
  let outLength = 0;
  const push = (line: string) => {
    if (out.length > 0) outLength += 1;
    outLength += line.length;
    out.push(line);
  };
  const insertBlank = () => {
    // The blank line starts after the separator that follows the previous
    // line; the newline it adds sits at that start.
    inserted.push(out.length > 0 ? outLength + 1 : 0);
    push('');
  };
  let inFence = false;
  let fenceMarker = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks: pass through untouched, including the fence lines
    // themselves. The closing fence must use the SAME marker char and at
    // least as many of them — but matching length is tricky and rarely
    // matters in practice; we accept any line of the same marker char as
    // closing, which mirrors how most users write fences.
    if (inFence) {
      push(line);
      const closeMatch = line.match(/^\s{0,3}(```+|~~~+)\s*$/);
      if (closeMatch && closeMatch[1][0] === fenceMarker[0]) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }

    const fenceOpen = line.match(FENCE_OPEN_RE);
    if (fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[1];
      push(line);
      continue;
    }

    const block = isBlockTagLine(line);
    if (!block) {
      push(line);
      continue;
    }

    // For a closing tag, ensure the previous emitted line is blank so that
    // the preceding markdown paragraph terminates before the HTML block.
    if (block.isClose && out.length > 0 && out[out.length - 1].trim() !== '') {
      insertBlank();
    }

    push(line);

    // For an opening tag, ensure the next input line is blank so that the
    // markdown content following the tag is parsed as its own block.
    if (!block.isClose && i + 1 < lines.length && lines[i + 1].trim() !== '') {
      insertBlank();
    }
  }

  return { text: out.join('\n'), inserted };
}

/** The input offset of an offset in {@link normalizeHtmlBlocksWithOffsets}'
 * output. */
export function toInputOffset(
  inserted: readonly number[],
  offset: number,
): number {
  let before = 0;
  for (const at of inserted) {
    if (at >= offset) break;
    before += 1;
  }
  return offset - before;
}
