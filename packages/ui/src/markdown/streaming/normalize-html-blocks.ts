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
  // Cheap pre-check — most messages contain no HTML at all.
  if (!text || text.indexOf('<') === -1) return text;

  const lines = text.split('\n');
  const out: string[] = [];
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
      out.push(line);
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
      out.push(line);
      continue;
    }

    const block = isBlockTagLine(line);
    if (!block) {
      out.push(line);
      continue;
    }

    // For a closing tag, ensure the previous emitted line is blank so that
    // the preceding markdown paragraph terminates before the HTML block.
    if (block.isClose && out.length > 0 && out[out.length - 1].trim() !== '') {
      out.push('');
    }

    out.push(line);

    // For an opening tag, ensure the next input line is blank so that the
    // markdown content following the tag is parsed as its own block.
    if (!block.isClose && i + 1 < lines.length && lines[i + 1].trim() !== '') {
      out.push('');
    }
  }

  return out.join('\n');
}
