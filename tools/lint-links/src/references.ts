/**
 * Addresses a source file points at the documentation sites with. Two
 * shapes: an absolute URL on one of the sites' origins, wherever it is
 * written (code, a README, a workflow, a message catalog), and a docs path
 * that code appends to the docs origin at run time — a template literal that
 * starts with the `DOCS_URL` or `TALE_DOCS_URL` constant, the marketing site's
 * `docsPath` fields and the `docs:` lists in its message catalogs. A new way of building a docs address belongs here,
 * with a test, or its links go unjudged.
 */

import {
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Node,
} from 'yaml';

export interface Reference {
  /** The absolute address the file points at. */
  url: string;
  line: number;
  column: number;
}

/** Line and column (1-based) of `offset` in `text`. */
function positionOf(
  text: string,
  offset: number,
): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * An address ends at whitespace, a quote, a bracket or angle bracket, a
 * backslash (an escape in a string literal) or a pipe; trailing sentence
 * punctuation is not part of it.
 */
const ADDRESS_TAIL = String.raw`(?:/[^\s"'\x60<>()[\]{}\\|^]*)?`;

/** Every absolute URL on one of `origins` written in `text`. */
export function originReferences(
  text: string,
  origins: readonly string[],
): Reference[] {
  if (origins.length === 0) return [];
  const pattern = new RegExp(
    `(?:${origins.map(escapeRegex).join('|')})(?![\\w.-])${ADDRESS_TAIL}`,
    'g',
  );
  const references: Reference[] = [];
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    const url = match[0].replace(/[.,;:!?]+$/, '');
    // A template (`${slug}`, `{{slug}}`, `:slug`) is not an address yet, and
    // one trailing off into an ellipsis is prose describing a shape.
    if (
      /\$\{|\{\{|\/:[a-z]|…|\.\.\./i.test(
        text.slice(at, at + match[0].length + 2),
      )
    ) {
      continue;
    }
    references.push({ url, ...positionOf(text, at) });
  }
  return references;
}

/** A template literal that opens with the `DOCS_URL` / `TALE_DOCS_URL` constant. */
const DOCS_URL_TEMPLATE = /\$\{\s*(?:TALE_)?DOCS_URL\s*\}(\/[^\s"'`$\\{}]*)/g;
/** The `docsPath` field of the marketing site's platform pages. */
const DOCS_PATH_FIELD = /\bdocsPath:\s*['"](\/[^'"]*)['"]/g;

/** Docs paths the code appends to the docs origin, as absolute addresses. */
export function docsPathReferences(
  file: string,
  text: string,
  docsOrigin: string,
): Reference[] {
  const references: Reference[] = [];
  if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
    for (const pattern of [DOCS_URL_TEMPLATE, DOCS_PATH_FIELD]) {
      for (const match of text.matchAll(pattern)) {
        const path = match[1] ?? '';
        if (/…|\.\.\./.test(path)) continue;
        references.push({
          url: `${docsOrigin}${path}`,
          ...positionOf(text, (match.index ?? 0) + match[0].indexOf(path)),
        });
      }
    }
  }
  if (/(?:^|\/)services\/web\/messages\/[^/]+\.ya?ml$/.test(file)) {
    references.push(...catalogDocsPaths(text, docsOrigin));
  }
  return references;
}

/**
 * The marketing site's message catalogs list the docs a page links as
 * `docs: [{label, path}]`; `path` is appended to the docs origin (an
 * absolute `http` path is used as is, and judged as an origin reference).
 */
function catalogDocsPaths(text: string, docsOrigin: string): Reference[] {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter });
  const references: Reference[] = [];
  const visit = (node: Node | null | undefined, underDocs: boolean) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : '';
        if (underDocs && key === 'path' && isScalar(pair.value)) {
          const path = String(pair.value.value);
          if (path.startsWith('/')) {
            const { line, col } = lineCounter.linePos(
              pair.value.range?.[0] ?? 0,
            );
            references.push({ url: `${docsOrigin}${path}`, line, column: col });
          }
        }
        visit(pair.value as Node, key === 'docs');
      }
    } else if (isSeq(node)) {
      for (const item of node.items) visit(item as Node, underDocs);
    }
  };
  visit(document.contents, false);
  return references;
}
