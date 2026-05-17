/**
 * Minimal HTML → Markdown converter for the build-time `.md` artifacts.
 *
 * The input is the React SSR output of a Tale marketing/docs page: a small,
 * predictable set of tags. We don't pull in a generalised converter
 * (turndown etc.) because we want to:
 *   - skip chrome (nav / header / footer / buttons / forms),
 *   - keep the conversion small and easy to audit,
 *   - emit markdown tables for our comparison grids.
 *
 * The output is intended for LLM consumption — readable to humans, but
 * tuned for "semantic body content only" rather than pixel parity.
 */

// `jsdom` is loaded lazily inside `htmlToMarkdown` (see below) — a static
// import at module load forces `jsdom`'s optional native `canvas`
// dependency to resolve even in environments that never call the
// function (e.g. Docker builds that just touch the `@tale/seo` barrel
// through a Vite config).

// ---------------------------------------------------------------------------
// Element selection rules
// ---------------------------------------------------------------------------

/** Tags whose subtree we drop entirely (chrome and non-content elements). */
const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'button',
  'nav',
  'header',
  'footer',
  'form',
  'input',
  'select',
  'textarea',
  'aside',
]);

/** ARIA roles whose elements are treated like `SKIP_TAGS`. */
const SKIP_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'button']);

/** Tags that map to markdown headings (`<h1>` → `# `, `<h2>` → `## `, …). */
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isSkippedElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return true;
  const role = el.getAttribute('role');
  if (role && SKIP_ROLES.has(role)) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  return false;
}

/** Type-guard narrowing `Node` to `Element`. */
function isElement(node: Node): node is Element {
  return node.nodeType === node.ELEMENT_NODE;
}

// ---------------------------------------------------------------------------
// Inline rendering (text inside paragraphs, headings, list items, table cells)
// ---------------------------------------------------------------------------

function inlineText(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }
  if (!isElement(node)) return '';
  if (isSkippedElement(node)) return '';

  const tag = node.tagName.toLowerCase();
  const inner = Array.from(node.childNodes).map(inlineText).join('');

  switch (tag) {
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return inner.trim() ? `**${inner.trim()}**` : '';
    case 'em':
    case 'i':
      return inner.trim() ? `*${inner.trim()}*` : '';
    case 'code':
      return inner.trim() ? `\`${inner.trim()}\`` : '';
    case 'a': {
      const rawHref = node.getAttribute('href') ?? '';
      const text = inner.trim();
      if (!text) return '';
      // Normalise to detect dangerous URL schemes regardless of casing
      // or leading whitespace (e.g. `  JavaScript:alert(1)`).
      const normalised = rawHref.trim().toLowerCase();
      if (
        !rawHref ||
        normalised.startsWith('javascript:') ||
        normalised.startsWith('vbscript:')
      ) {
        return text;
      }
      return `[${text}](${rawHref})`;
    }
    default:
      return inner;
  }
}

// ---------------------------------------------------------------------------
// Block rendering — each element returns zero or more markdown "blocks"
// (paragraph-sized chunks joined later by blank lines).
// ---------------------------------------------------------------------------

function blocksFromElement(el: Element): string[] {
  if (isSkippedElement(el)) return [];
  const tag = el.tagName.toLowerCase();

  if (HEADING_TAGS.has(tag)) {
    const level = Number(tag.slice(1));
    const text = inlineText(el).trim();
    return text ? [`${'#'.repeat(level)} ${text}`] : [];
  }

  if (tag === 'p') {
    const text = inlineText(el).trim();
    return text ? [text] : [];
  }

  if (tag === 'ul' || tag === 'ol') {
    return listToMarkdown(el, tag === 'ol');
  }

  if (tag === 'table') {
    return tableToMarkdown(el);
  }

  if (tag === 'dl') {
    return descriptionListToMarkdown(el);
  }

  // Generic container — recurse into children.
  const out: string[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (isElement(child)) out.push(...blocksFromElement(child));
  }
  return out;
}

function listToMarkdown(el: Element, ordered: boolean): string[] {
  const items: string[] = [];
  let i = 1;
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    const text = inlineText(li).trim();
    if (!text) continue;
    items.push(`${ordered ? `${i}.` : '-'} ${text}`);
    i++;
  }
  return items.length ? [items.join('\n')] : [];
}

function tableToMarkdown(table: Element): string[] {
  interface Row {
    cells: string[];
    isHeader: boolean;
  }
  const rows: Row[] = [];

  table.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    let isHeader = false;
    tr.querySelectorAll('th, td').forEach((cell) => {
      if (cell.tagName.toLowerCase() === 'th') isHeader = true;
      const text = inlineText(cell).trim().replace(/\|/g, '\\|');
      cells.push(text);
    });
    if (cells.length) rows.push({ cells, isHeader });
  });

  if (!rows.length) return [];

  const cols = Math.max(...rows.map((r) => r.cells.length));
  const pad = (cells: string[]) =>
    Array.from({ length: cols }, (_, i) => cells[i] ?? '');

  const headerRow = rows.find((r) => r.isHeader) ?? rows[0];
  const bodyRows = rows.filter((r) => r !== headerRow);

  const lines = [
    `| ${pad(headerRow.cells).join(' | ')} |`,
    `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`,
    ...bodyRows.map((r) => `| ${pad(r.cells).join(' | ')} |`),
  ];
  return [lines.join('\n')];
}

function descriptionListToMarkdown(el: Element): string[] {
  const lines: string[] = [];
  let term = '';
  for (const child of Array.from(el.children)) {
    const t = child.tagName.toLowerCase();
    if (t === 'dt') {
      term = inlineText(child).trim();
    } else if (t === 'dd') {
      const def = inlineText(child).trim();
      if (term || def) lines.push(`- **${term}**: ${def}`);
      term = '';
    }
  }
  return lines.length ? [lines.join('\n')] : [];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function htmlToMarkdown(html: string): Promise<string> {
  // `jsdom` ships its own types but `@types/jsdom` isn't in the workspace.
  // The DOM surface we touch is tiny and standardised, so we declare a
  // minimal `any`-typed import and rely on the standard `Element` / `Node`
  // globals coming from `lib.dom` for the rest.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error — no @types/jsdom in deps
  const { JSDOM } = await import('jsdom');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  // `dom.window.document.body` is typed as `any` because jsdom lacks
  // type declarations in this workspace; narrow it through the type-guard.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body: Element = dom.window.document.body;

  const blocks: string[] = [];
  for (const child of Array.from(body.childNodes)) {
    if (isElement(child)) blocks.push(...blocksFromElement(child));
  }

  return (
    blocks
      .map((b) => b.trim())
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}
