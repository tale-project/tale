/**
 * OpenDocument Text (ODT) → HTML conversion for the document preview.
 *
 * An ODT is a zip whose `content.xml` is ODF XML. We unzip with jszip (the
 * same library the backend extractor's GuardedZip wraps) and walk the ODF
 * text tree with the platform `DOMParser` — headings (`text:h`), paragraphs
 * (`text:p`), spans (`text:span`), lists (`text:list`/`text:list-item`) and
 * tables (`table:table`/`table:table-row`/`table:table-cell`) — emitting
 * semantic HTML that the DOCX preview's prose styles already know how to
 * render. Mirrors the block subset of the backend extractor
 * (`convex/lib/knowledge/extraction/odt.ts`); exotic ODF features degrade to
 * plain paragraphs.
 *
 * All text lands in the output via `createTextNode`, so the produced markup
 * contains no document-controlled HTML; callers still sanitize with DOMPurify
 * before injecting (parity with the DOCX/XLSX preview hooks).
 */

import type JSZipType from 'jszip';

const OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';

/** Decompression cap for `content.xml` (zip-bomb guard), in UTF-16 units. */
const MAX_CONTENT_XML_CHARS = 50 * 1024 * 1024;

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** The `text:c` repeat count of a `text:s` (spaces) element, default 1. */
function spaceCount(el: Element): number {
  const raw =
    el.getAttribute('text:c') ?? el.getAttributeNS(null, 'c') ?? undefined;
  const count = Number(raw);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

/**
 * Append the inline content of an ODF element (text runs, spans, links, and
 * the whitespace elements `text:tab`, `text:line-break`, `text:s`) to `dest`.
 */
function appendInline(src: Element, dest: Element, out: Document): void {
  for (const node of Array.from(src.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      dest.appendChild(out.createTextNode(node.nodeValue ?? ''));
      continue;
    }
    if (!isElement(node)) continue;
    switch (node.localName) {
      case 'tab':
        // Non-breaking spaces survive HTML whitespace collapsing.
        dest.appendChild(out.createTextNode('    '));
        break;
      case 'line-break':
        dest.appendChild(out.createElement('br'));
        break;
      case 's':
        dest.appendChild(out.createTextNode(' '.repeat(spaceCount(node))));
        break;
      case 'note':
        // Footnotes/endnotes render inline in ODF; skip them in the preview.
        break;
      default:
        // Spans, links, and unknown inline wrappers: keep their text content.
        appendInline(node, dest, out);
    }
  }
}

/** Heading level from `text:outline-level`, clamped to h1–h4. */
function headingTag(el: Element): string {
  const raw = el.getAttribute('text:outline-level');
  const level = Number(raw);
  if (!Number.isFinite(level)) return 'h1';
  return `h${Math.min(Math.max(Math.trunc(level), 1), 4)}`;
}

/** Render an ODF table as `<table><tr><td>…`. */
function appendTable(table: Element, parent: Element, out: Document): void {
  const htmlTable = out.createElement('table');

  const appendRow = (row: Element): void => {
    const tr = out.createElement('tr');
    for (const cell of Array.from(row.children)) {
      // Skip `table:covered-table-cell` (merged-cell placeholders).
      if (cell.localName !== 'table-cell') continue;
      const td = out.createElement('td');
      appendBlocks(Array.from(cell.children), td, out);
      tr.appendChild(td);
    }
    htmlTable.appendChild(tr);
  };

  for (const child of Array.from(table.children)) {
    if (child.localName === 'table-row') {
      appendRow(child);
    } else if (child.localName === 'table-header-rows') {
      // Row groups wrap rows — descend into them.
      for (const row of Array.from(child.children)) {
        if (row.localName === 'table-row') appendRow(row);
      }
    }
  }

  if (htmlTable.childNodes.length > 0) parent.appendChild(htmlTable);
}

/** Render an ODF list as `<ul><li>…` (nested lists recurse). */
function appendList(list: Element, parent: Element, out: Document): void {
  const ul = out.createElement('ul');
  for (const item of Array.from(list.children)) {
    if (item.localName !== 'list-item' && item.localName !== 'list-header') {
      continue;
    }
    const li = out.createElement('li');
    appendBlocks(Array.from(item.children), li, out);
    ul.appendChild(li);
  }
  if (ul.childNodes.length > 0) parent.appendChild(ul);
}

/**
 * Walk ordered block-level ODF children (`text:h`, `text:p`, `text:list`,
 * `table:table`, transparent `text:section`s), appending HTML to `parent`.
 */
function appendBlocks(nodes: Element[], parent: Element, out: Document): void {
  for (const node of nodes) {
    switch (node.localName) {
      case 'h': {
        const heading = out.createElement(headingTag(node));
        appendInline(node, heading, out);
        if (heading.textContent?.trim()) parent.appendChild(heading);
        break;
      }
      case 'p': {
        const p = out.createElement('p');
        appendInline(node, p, out);
        // Keep empty paragraphs out; ODF uses them for vertical spacing.
        if (p.textContent?.trim() || p.querySelector('br')) {
          parent.appendChild(p);
        }
        break;
      }
      case 'list':
        appendList(node, parent, out);
        break;
      case 'table':
        appendTable(node, parent, out);
        break;
      case 'section':
      case 'soft-page-break':
        appendBlocks(Array.from(node.children), parent, out);
        break;
      default:
        break;
    }
  }
}

/**
 * Convert the `content.xml` of an ODT to semantic HTML.
 * Throws on malformed XML or a missing `<office:text>` body.
 */
export function odtContentXmlToHtml(contentXml: string): string {
  const doc = new DOMParser().parseFromString(contentXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('ODT preview failed: could not parse content.xml');
  }

  const body = Array.from(doc.getElementsByTagNameNS(OFFICE_NS, 'text'))[0];
  if (!body) {
    throw new Error(
      'ODT preview failed: content.xml is missing an <office:text> body (not a valid OpenDocument Text file)',
    );
  }

  const out = document.implementation.createHTMLDocument('');
  appendBlocks(Array.from(body.children), out.body, out);
  return out.body.innerHTML;
}

/**
 * Convert raw ODT bytes to semantic HTML: unzip, read `content.xml`, convert.
 * Throws on an invalid/corrupt archive, a missing or oversized `content.xml`,
 * or unparseable ODF XML.
 */
export async function odtBytesToHtml(bytes: ArrayBuffer): Promise<string> {
  // Dynamic import keeps jszip out of the preview route's initial chunk
  // (parity with the mammoth/xlsx imports in `use-document-preview.ts`).
  const { default: JSZip } = await import('jszip');

  let zip: JSZipType;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    throw new Error('ODT preview failed: invalid or corrupt archive', {
      cause: err,
    });
  }

  const entry = zip.file('content.xml');
  if (!entry) {
    throw new Error(
      'ODT preview failed: no readable content.xml (not a valid OpenDocument Text file)',
    );
  }

  const contentXml = await entry.async('string');
  if (contentXml.length > MAX_CONTENT_XML_CHARS) {
    throw new Error('ODT preview failed: content.xml exceeds the size limit');
  }

  return odtContentXmlToHtml(contentXml);
}
