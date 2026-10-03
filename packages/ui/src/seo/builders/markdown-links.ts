import { parse, postprocess, preprocess } from 'micromark';
import { decodeString } from 'micromark-util-decode-string';
import { type DefaultTreeAdapterMap, parseFragment } from 'parse5';

import { absoluteSitePath } from '../urls';

interface Range {
  start: number;
  end: number;
}

interface Edit extends Range {
  value: string;
}

const LITERAL_ELEMENTS = new Set([
  'code',
  'pre',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);
const URL_ATTRIBUTES = new Set(['href', 'src', 'poster']);

function resolveDestination(
  value: string,
  pageUrl: string,
  siteUrl?: string,
): string | null {
  // Keep explicit schemes exactly as authored (including mailto and data).
  // Fragments and query-only references still name the source HTML page,
  // even when several pages are combined into one exported document.
  if (!value || /^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  try {
    // Authored slash-root links follow the site's configured mount, as the
    // docs router and media components do. Network-path references still
    // name their own host, while other references use the source page.
    const destination =
      siteUrl && value.startsWith('/') && !value.startsWith('//')
        ? absoluteSitePath(siteUrl, value)
        : value;
    return new URL(destination, pageUrl).href;
  } catch {
    // A malformed authored destination must not make an entire export fail.
    return null;
  }
}

function htmlEdits(
  body: string,
  ranges: readonly Range[],
  pageUrl: string,
  siteUrl?: string,
): { edits: Edit[]; literals: Range[] } {
  const edits: Edit[] = [];
  const literals: Range[] = [];
  if (ranges.length === 0) return { edits, literals };

  // Only parser-recognized HTML reaches the HTML parser. Masking everything
  // else keeps offsets and inline <code> ancestry without interpreting a
  // tag shown inside a Markdown code example as a real element.
  const parts: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    parts.push(body.slice(cursor, range.start).replace(/[^\r\n]/g, ' '));
    parts.push(body.slice(range.start, range.end));
    cursor = range.end;
  }
  parts.push(body.slice(cursor).replace(/[^\r\n]/g, ' '));
  const htmlSource = parts.join('');
  const tree = parseFragment(htmlSource, { sourceCodeLocationInfo: true });

  function visit(node: DefaultTreeAdapterMap['childNode']): void {
    if (!('tagName' in node)) return;
    const location = node.sourceCodeLocation;
    const literal = LITERAL_ELEMENTS.has(node.tagName);
    if (literal) {
      if (location)
        literals.push({ start: location.startOffset, end: location.endOffset });
    }
    for (const attribute of node.attrs) {
      // Tale's Video component maps captions to a native track's src.
      if (
        !URL_ATTRIBUTES.has(attribute.name) &&
        !(node.tagName === 'video' && attribute.name === 'captions')
      )
        continue;
      const span = location?.attrs?.[attribute.name];
      const absolute = resolveDestination(attribute.value, pageUrl, siteUrl);
      if (!span || absolute === null) continue;
      // parse5 identifies the real attribute and decodes entities. Locate
      // only its value inside that bounded source span; do not reserialize
      // the element, which would change custom tag casing and other props.
      let start = htmlSource.indexOf('=', span.startOffset) + 1;
      while (/\s/.test(htmlSource[start] ?? '')) start++;
      const quote =
        body[start] === '"' || body[start] === "'" ? body[start] : '';
      if (quote && body[span.endOffset - 1] !== quote) continue;
      const escaped = absolute
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      edits.push({
        start: start + quote.length,
        end: span.endOffset - quote.length,
        value: quote ? escaped : `"${escaped}"`,
      });
    }
    if (literal) return;
    for (const child of node.childNodes) visit(child);
  }
  for (const child of tree.childNodes) visit(child);
  return { edits, literals };
}

/**
 * Resolve real Markdown/HTML destinations against their source page. Concrete
 * token ranges preserve labels, titles, whitespace and literal examples; a
 * shared path serves per-page downloads, clipboard copies and llms-full.txt.
 */
export function normalizeMarkdownLinks(
  body: string,
  pageUrl: string,
  siteUrl?: string,
): string {
  const destinations: Range[] = [];
  const html: Range[] = [];
  const events = postprocess(
    parse()
      .document()
      .write(preprocess()(body, undefined, true)),
  );
  for (const [kind, token] of events) {
    if (kind !== 'enter') continue;
    const range = { start: token.start.offset, end: token.end.offset };
    if (
      token.type === 'resourceDestinationString' ||
      token.type === 'definitionDestinationString'
    )
      destinations.push(range);
    else if (token.type === 'htmlFlowData' || token.type === 'htmlTextData')
      html.push(range);
  }
  const { edits, literals } = htmlEdits(body, html, pageUrl, siteUrl);
  for (const range of destinations) {
    if (
      literals.some(
        (literal) => range.start >= literal.start && range.end <= literal.end,
      )
    )
      continue;
    const absolute = resolveDestination(
      decodeString(body.slice(range.start, range.end)),
      pageUrl,
      siteUrl,
    );
    if (absolute === null) continue;
    edits.push({
      ...range,
      // An ampersand in a decoded destination may itself begin an entity.
      // Escape it once, and protect Markdown's destination delimiters.
      value: absolute.replace(/&/g, '&amp;').replace(/[\\()<>]/g, '\\$&'),
    });
  }
  let output = body;
  // HTML's recovery algorithm may clone a formatting element while keeping
  // its source position. Each authored attribute must still be edited once.
  const uniqueEdits = new Map(
    edits.map((edit) => [`${edit.start}:${edit.end}`, edit]),
  );
  for (const edit of [...uniqueEdits.values()].sort(
    (a, b) => b.start - a.start,
  ))
    output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  return output;
}
