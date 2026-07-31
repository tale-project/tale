'use node';

/**
 * OpenDocument Text (ODT) extraction.
 *
 * ODT is a zip whose `content.xml` is ODF XML. We unzip with the shared
 * {@link GuardedZip} helper (zip-bomb guarded), parse `content.xml` with
 * fast-xml-parser, and walk the ODF text tree — headings (`text:h`),
 * paragraphs (`text:p`), spans (`text:span`), lists
 * (`text:list`/`text:list-item`) and tables
 * (`table:table`/`table:table-row`/`table:table-cell`) — to emit plain text.
 *
 * Mirrors the structure and output shape of the DOCX extractor: block-level
 * elements are joined by blank lines, tables are rendered with a `[Table]`
 * marker followed by pipe-joined rows. ODF has no embedded-image relationship
 * model comparable to OOXML `a:blip`/`r:embed`, so there is no Vision path here;
 * the return tuple keeps the `[text, visionUsed]` contract with `visionUsed`
 * always `false`.
 */

import { XMLParser } from 'fast-xml-parser';

import { extractTableText } from './helpers';
import { GuardedZip } from './ooxml';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
});

type XmlNode = Record<string, unknown>;

/** Runtime guard: fast-xml-parser (preserveOrder) yields an array of nodes. */
function isXmlNodeArray(value: unknown): value is XmlNode[] {
  return (
    Array.isArray(value) &&
    value.every((node) => typeof node === 'object' && node !== null)
  );
}

/** Strip a namespace prefix from an ODF tag name (`text:p` -> `p`). */
function localName(tag: string): string {
  const idx = tag.indexOf(':');
  return idx === -1 ? tag : tag.slice(idx + 1);
}

/** The tag name of a preserveOrder node (first non-meta key). */
function tagOf(node: XmlNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== '#text') {
      return key;
    }
  }
  return '';
}

/** The single child-array of a preserveOrder node (the tag's content). */
function childrenOf(node: XmlNode): XmlNode[] {
  for (const key of Object.keys(node)) {
    if (key === ':@' || key === '#text') {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

/**
 * Recursively collect inline text under a node, in document order. Handles the
 * ODF whitespace elements: `text:tab` -> tab, `text:line-break` -> newline,
 * and `text:s` (spaces) -> a run of spaces (its `text:c` count, default 1).
 */
function collectText(node: XmlNode): string {
  const tag = localName(tagOf(node));

  if (tag === 'tab') {
    return '\t';
  }
  if (tag === 'line-break') {
    return '\n';
  }
  if (tag === 's') {
    const attrs = node[':@'];
    let count = 1;
    if (typeof attrs === 'object' && attrs !== null && '@_text:c' in attrs) {
      count = Number(attrs['@_text:c']) || 1;
    }
    return ' '.repeat(Math.max(1, count));
  }

  let text = '';
  for (const child of childrenOf(node)) {
    if (typeof child['#text'] === 'string') {
      text += child['#text'];
    } else {
      text += collectText(child);
    }
  }
  return text;
}

/** Render an ODF table node as pipe-joined rows. */
function tableRows(table: XmlNode): string[][] {
  const rows: string[][] = [];
  for (const child of childrenOf(table)) {
    const childTag = localName(tagOf(child));
    // Row groups (`table:table-header-rows`) wrap rows — descend into them.
    if (childTag === 'table-header-rows') {
      for (const row of childrenOf(child)) {
        if (localName(tagOf(row)) === 'table-row') {
          rows.push(rowCells(row));
        }
      }
    } else if (childTag === 'table-row') {
      rows.push(rowCells(child));
    }
  }
  return rows;

  function rowCells(row: XmlNode): string[] {
    const cells: string[] = [];
    for (const cell of childrenOf(row)) {
      const cellTag = localName(tagOf(cell));
      // Skip `table:covered-table-cell` (merged-cell placeholders).
      if (cellTag === 'table-cell') {
        cells.push(collectText(cell).trim());
      }
    }
    return cells;
  }
}

/**
 * Walk the ordered block-level children of `<office:text>` (or a list/section
 * container), appending rendered text blocks to `out`. Lists are flattened:
 * each `text:list-item`'s paragraphs become their own blocks so list content
 * is preserved in reading order.
 */
function walkBlocks(nodes: XmlNode[], out: string[]): void {
  for (const node of nodes) {
    const tag = localName(tagOf(node));

    if (tag === 'h' || tag === 'p') {
      const text = collectText(node).trim();
      if (text) {
        out.push(text);
      }
    } else if (tag === 'list' || tag === 'list-item') {
      // Recurse: list-items hold paragraphs (and possibly nested lists).
      walkBlocks(childrenOf(node), out);
    } else if (tag === 'table') {
      const tableText = extractTableText(tableRows(node));
      if (tableText) {
        out.push(`[Table]\n${tableText}`);
      }
    } else if (tag === 'section' || tag === 'soft-page-break') {
      // Sections are transparent containers; descend into them.
      walkBlocks(childrenOf(node), out);
    }
  }
}

export interface OdtExtractionOptions {
  /** Present for router parity; ODT has no Vision path (see file header). */
  processImages?: boolean;
}

/**
 * Extract text from ODT bytes. Returns `[text, visionUsed]`; `visionUsed` is
 * always `false` (ODF has no embedded-image relationship model we describe).
 * Throws on an invalid/corrupt archive or a missing/empty `content.xml`.
 */
export async function extractTextFromOdtBytes(
  odtBytes: Uint8Array,
  filename = 'document.odt',
  _options: OdtExtractionOptions = {},
): Promise<[string, boolean]> {
  const zip = await GuardedZip.load(odtBytes);

  const contentXml = await zip.readString('content.xml');
  if (!contentXml) {
    throw new Error(
      `ODT extraction failed: ${filename} has no readable content.xml (not a valid OpenDocument Text file)`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parser.parse(contentXml);
  } catch (err) {
    throw new Error(`ODT extraction failed: could not parse content.xml`, {
      cause: err,
    });
  }
  if (!isXmlNodeArray(parsed)) {
    throw new Error(
      `ODT extraction failed: unexpected content.xml structure in ${filename}`,
    );
  }
  const tree: XmlNode[] = parsed;

  // Locate the `<office:text>` body children in order.
  let body: XmlNode[] | null = null;
  const findText = (nodes: XmlNode[]): void => {
    for (const node of nodes) {
      if (body) {
        return;
      }
      if (localName(tagOf(node)) === 'text') {
        body = childrenOf(node);
        return;
      }
      findText(childrenOf(node));
    }
  };
  findText(tree);

  if (!body) {
    throw new Error(
      `ODT extraction failed: ${filename} is missing an <office:text> body (not a valid OpenDocument Text file)`,
    );
  }

  const blocks: string[] = [];
  walkBlocks(body, blocks);

  const content = blocks.join('\n\n');
  console.info(`ODT processing complete: ${blocks.length} blocks`);
  return [content, false];
}
