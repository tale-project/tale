'use node';

/**
 * HTML → structured DocxSection list.
 *
 * Ports `services/crawler/app/services/html_to_docx_converter.py` (BeautifulSoup
 * → sections). We use `parse5` for standards-compliant HTML parsing instead of
 * BeautifulSoup; the traversal logic (heading/list/table/blockquote/pre/
 * container handling, first-h1-as-title, whitespace collapsing, table
 * header/row normalisation) is reproduced 1:1.
 */

import { parse } from 'parse5';

import type { DocxContent, DocxSection } from './docx_generate';

// parse5 exposes a generic tree; we normalise it into this minimal shape with
// runtime guards (no type assertions) rather than depending on its internal AST
// types (not part of the stable surface). `toP5Node` reads each field defensively.
interface P5Node {
  nodeName: string;
  value?: string;
  tagName?: string;
  childNodes: P5Node[];
}

/** Defensively normalise an unknown parse5 node into {@link P5Node}. */
function toP5Node(value: unknown): P5Node {
  if (value === null || typeof value !== 'object') {
    return { nodeName: '#unknown', childNodes: [] };
  }
  const nodeName = Reflect.get(value, 'nodeName');
  const tagName = Reflect.get(value, 'tagName');
  const text = Reflect.get(value, 'value');
  const rawChildren = Reflect.get(value, 'childNodes');
  const childNodes = Array.isArray(rawChildren)
    ? rawChildren.map(toP5Node)
    : [];
  const node: P5Node = {
    nodeName: typeof nodeName === 'string' ? nodeName : '#unknown',
    childNodes,
  };
  if (typeof tagName === 'string') {
    node.tagName = tagName;
  }
  if (typeof text === 'string') {
    node.value = text;
  }
  return node;
}

const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
]);

const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'head']);

function children(node: P5Node): P5Node[] {
  return node.childNodes;
}

function isText(node: P5Node): boolean {
  return node.nodeName === '#text';
}

function isElement(node: P5Node): boolean {
  return typeof node.tagName === 'string';
}

/** Recursively collect text, collapsing all whitespace runs to single spaces. */
function getText(node: P5Node): string {
  let text = '';
  const walk = (n: P5Node): void => {
    if (isText(n)) {
      text += n.value ?? '';
      return;
    }
    for (const child of children(n)) {
      walk(child);
    }
  };
  walk(node);
  return text.replace(/\s+/g, ' ').trim();
}

/** Find the first descendant element with the given tag name (depth-first). */
function findFirst(node: P5Node, tagName: string): P5Node | null {
  for (const child of children(node)) {
    if (isElement(child) && child.tagName === tagName) {
      return child;
    }
    const nested = findFirst(child, tagName);
    if (nested) {
      return nested;
    }
  }
  return null;
}

/** Direct-child elements with one of the given tag names. */
function directChildren(node: P5Node, tagNames: Set<string>): P5Node[] {
  return children(node).filter(
    (c) =>
      isElement(c) && typeof c.tagName === 'string' && tagNames.has(c.tagName),
  );
}

/** All descendant elements with one of the given tag names. */
function findAll(node: P5Node, tagNames: Set<string>): P5Node[] {
  const out: P5Node[] = [];
  const walk = (n: P5Node): void => {
    for (const child of children(n)) {
      if (
        isElement(child) &&
        typeof child.tagName === 'string' &&
        tagNames.has(child.tagName)
      ) {
        out.push(child);
      }
      walk(child);
    }
  };
  walk(node);
  return out;
}

const LI_TAG = new Set(['li']);

function parseListItems(listTag: P5Node): string[] {
  const items: string[] = [];
  for (const li of directChildren(listTag, LI_TAG)) {
    const text = getText(li);
    if (text) {
      items.push(text);
    }
  }
  return items;
}

const TR_TAG = new Set(['tr']);
const TH_TAG = new Set(['th']);
const CELL_TAGS = new Set(['td', 'th']);

function parseTable(tableTag: P5Node): {
  headers: string[];
  rows: string[][];
} | null {
  let headers: string[] = [];
  const rows: string[][] = [];

  const thead = findFirst(tableTag, 'thead');
  if (thead) {
    for (const th of findAll(thead, TH_TAG)) {
      headers.push(getText(th));
    }
  }

  const tbody = findFirst(tableTag, 'tbody') ?? tableTag;
  for (const tr of directChildren(tbody, TR_TAG)) {
    const cells = directChildren(tr, CELL_TAGS);
    if (cells.length === 0) {
      continue;
    }
    if (headers.length === 0 && cells.every((c) => c.tagName === 'th')) {
      headers = cells.map((c) => getText(c));
      continue;
    }
    rows.push(cells.map((c) => getText(c)));
  }

  if (headers.length === 0 && rows.length === 0) {
    return null;
  }

  if (headers.length === 0 && rows.length > 0) {
    const colCount = Math.max(...rows.map((r) => r.length));
    headers = Array.from({ length: colCount }, (_v, i) => `Column ${i + 1}`);
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length < headers.length) {
      rows[i] = [...row, ...Array(headers.length - row.length).fill('')];
    } else if (row.length > headers.length) {
      rows[i] = row.slice(0, headers.length);
    }
  }

  return { headers, rows };
}

function processElement(
  element: P5Node,
  sections: DocxSection[],
  titleRef: { value: string | null },
): void {
  const tagName = (element.tagName ?? '').toLowerCase();

  if (SKIP_TAGS.has(tagName)) {
    return;
  }

  const headingLevel = HEADING_LEVELS[tagName];
  if (headingLevel !== undefined) {
    const text = getText(element);
    if (!text) {
      return;
    }
    if (headingLevel === 1 && titleRef.value === null) {
      titleRef.value = text;
    } else {
      sections.push({ type: 'heading', level: headingLevel, text });
    }
    return;
  }

  if (tagName === 'ul') {
    const items = parseListItems(element);
    if (items.length > 0) {
      sections.push({ type: 'bullets', items });
    }
    return;
  }

  if (tagName === 'ol') {
    const items = parseListItems(element);
    if (items.length > 0) {
      sections.push({ type: 'numbered', items });
    }
    return;
  }

  if (tagName === 'table') {
    const tableData = parseTable(element);
    if (tableData) {
      sections.push({
        type: 'table',
        headers: tableData.headers,
        rows: tableData.rows,
      });
    }
    return;
  }

  if (tagName === 'blockquote') {
    const text = getText(element);
    if (text) {
      sections.push({ type: 'quote', text });
    }
    return;
  }

  if (tagName === 'pre') {
    const code = findFirst(element, 'code');
    // Code preserves whitespace — do not collapse like getText does.
    const rawText = rawTextOf(code ?? element);
    if (rawText.trim()) {
      sections.push({ type: 'code', text: rawText.trim() });
    }
    return;
  }

  if (CONTAINER_TAGS.has(tagName)) {
    processChildren(element, sections, titleRef);
    return;
  }

  const text = getText(element);
  if (text) {
    sections.push({ type: 'paragraph', text });
  }
}

/** Raw concatenated text WITHOUT whitespace collapsing (for code blocks). */
function rawTextOf(node: P5Node): string {
  let text = '';
  const walk = (n: P5Node): void => {
    if (isText(n)) {
      text += n.value ?? '';
      return;
    }
    for (const child of children(n)) {
      walk(child);
    }
  };
  walk(node);
  return text;
}

function processChildren(
  parent: P5Node,
  sections: DocxSection[],
  titleRef: { value: string | null },
): void {
  for (const child of children(parent)) {
    if (isText(child)) {
      const text = (child.value ?? '').trim();
      if (text) {
        sections.push({ type: 'paragraph', text });
      }
      continue;
    }
    if (isElement(child)) {
      processElement(child, sections, titleRef);
    }
  }
}

/** Convert HTML to structured content. Mirrors `html_to_sections()`. */
export function htmlToSections(html: string): DocxContent {
  const doc = toP5Node(parse(html));
  const body = findFirst(doc, 'body') ?? doc;

  const sections: DocxSection[] = [];
  const titleRef: { value: string | null } = { value: null };

  processChildren(body, sections, titleRef);

  return {
    title: titleRef.value ?? 'Untitled Document',
    sections,
  };
}
