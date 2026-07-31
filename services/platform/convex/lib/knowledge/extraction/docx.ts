'use node';

/**
 * Smart DOCX text extraction with Vision API support.
 *
 * Parses the OOXML (`word/document.xml`, headers/footers, relationships)
 * directly so the relative order of text, tables, page breaks, and images is
 * preserved — matching the previous python-docx implementation. Image bytes
 * are pulled from the package parts and described via the Vision API.
 */

import { XMLParser } from 'fast-xml-parser';

import { describeImageBytes, extractTableText, Semaphore } from './helpers';
import { GuardedZip } from './ooxml';
import type { VisionClient } from './vision_client';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
});

type XmlNode = Record<string, unknown>;

/** Strip a namespace prefix from an OOXML tag name (`w:p` -> `p`). */
function localName(tag: string): string {
  const idx = tag.indexOf(':');
  return idx === -1 ? tag : tag.slice(idx + 1);
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

/** The tag name of a preserveOrder node (first non-meta key). */
function tagOf(node: XmlNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== '#text') {
      return key;
    }
  }
  return '';
}

function attrs(node: XmlNode): Record<string, string> {
  const meta = node[':@'];
  if (meta && typeof meta === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta)) {
      out[k] = String(v);
    }
    return out;
  }
  return {};
}

/** Recursively collect text from `w:t` runs under a node, in order. */
function collectText(node: XmlNode): string {
  let text = '';
  const tag = localName(tagOf(node));
  if (tag === 't') {
    const children = childrenOf(node);
    for (const child of children) {
      if (typeof child['#text'] === 'string') {
        text += child['#text'];
      }
    }
    return text;
  }
  if (tag === 'tab') {
    return '\t';
  }
  if (tag === 'br' || tag === 'cr') {
    return '\n';
  }
  for (const child of childrenOf(node)) {
    text += collectText(child);
  }
  return text;
}

/** Detect explicit page breaks in a paragraph node. */
function hasPageBreak(paragraph: XmlNode): boolean {
  const children = childrenOf(paragraph);
  for (const child of children) {
    if (localName(tagOf(child)) === 'pPr') {
      for (const prop of childrenOf(child)) {
        if (localName(tagOf(prop)) === 'pageBreakBefore') {
          const val = attrs(prop)['@_w:val'];
          if (val === undefined || (val !== '0' && val !== 'false')) {
            return true;
          }
        }
      }
    }
  }
  // Any inline <w:br w:type="page">.
  const stack = [...children];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (localName(tagOf(node)) === 'br' && attrs(node)['@_w:type'] === 'page') {
      return true;
    }
    stack.push(...childrenOf(node));
  }
  return false;
}

/** Collect embed relationship ids referenced by `a:blip` in a paragraph. */
function collectBlipEmbeds(node: XmlNode, out: string[]): void {
  if (localName(tagOf(node)) === 'blip') {
    const embed = attrs(node)['@_r:embed'];
    if (embed) {
      out.push(embed);
    }
  }
  for (const child of childrenOf(node)) {
    collectBlipEmbeds(child, out);
  }
}

interface RelTarget {
  id: string;
  target: string;
  type: string;
}

function parseRelationships(xml: string): RelTarget[] {
  const tree = parser.parse(xml);
  const rels: RelTarget[] = [];
  const walk = (nodes: XmlNode[]): void => {
    for (const node of nodes) {
      if (localName(tagOf(node)) === 'Relationship') {
        const a = attrs(node);
        rels.push({
          id: a['@_Id'] ?? '',
          target: a['@_Target'] ?? '',
          type: a['@_Type'] ?? '',
        });
      }
      walk(childrenOf(node));
    }
  };
  walk(tree);
  return rels;
}

function paragraphText(paragraph: XmlNode): string {
  return collectText(paragraph).trim();
}

function tableRows(table: XmlNode): string[][] {
  const rows: string[][] = [];
  for (const child of childrenOf(table)) {
    if (localName(tagOf(child)) === 'tr') {
      const cells: string[] = [];
      for (const cell of childrenOf(child)) {
        if (localName(tagOf(cell)) === 'tc') {
          cells.push(collectText(cell).trim());
        }
      }
      rows.push(cells);
    }
  }
  return rows;
}

export interface DocxExtractionOptions {
  visionClient?: VisionClient | null;
  processImages?: boolean;
  maxConcurrent?: number;
}

/**
 * Extract text from DOCX bytes with optional Vision support. Returns
 * `[text, visionUsed, pageBreakPositions]`. `pageBreakPositions` is the list of
 * element position indices where explicit page breaks occur; the text output
 * is not modified by them.
 */
export async function extractTextFromDocxBytes(
  docxBytes: Uint8Array,
  filename = 'document.docx',
  options: DocxExtractionOptions = {},
): Promise<[string, boolean, number[]]> {
  const visionClient = options.visionClient ?? null;
  const processImages = options.processImages ?? true;
  const maxConcurrent = options.maxConcurrent ?? 3;

  const zip = await GuardedZip.load(docxBytes);

  const documentXml = await zip.readString('word/document.xml');
  if (!documentXml) {
    return ['', false, []];
  }

  const semaphore = new Semaphore(maxConcurrent);

  // Build relationship id -> image bytes map.
  const imageRels = new Map<string, Uint8Array>();
  if (processImages && visionClient) {
    const relsXml = await zip.readString('word/_rels/document.xml.rels');
    if (relsXml) {
      for (const rel of parseRelationships(relsXml)) {
        if (rel.type.endsWith('/image')) {
          const target = rel.target
            .replace(/^\/?word\//, '')
            .replace(/^\.\.\//, '');
          const bytes =
            (await zip.readBytes(`word/${target}`)) ??
            (await zip.readBytes(target));
          if (bytes) {
            imageRels.set(rel.id, bytes);
          }
        }
      }
    }
  }

  const tree = parser.parse(documentXml);
  // Locate the <w:body> children in order.
  let body: XmlNode[] = [];
  const findBody = (nodes: XmlNode[]): void => {
    for (const node of nodes) {
      if (localName(tagOf(node)) === 'body') {
        body = childrenOf(node);
        return;
      }
      findBody(childrenOf(node));
    }
  };
  findBody(tree);

  const elements: [number, string][] = [];
  let position = 0;
  let visionUsed = false;
  const pageBreakPositions: number[] = [];
  const processedRids = new Set<string>();

  for (const element of body) {
    const tag = localName(tagOf(element));

    if (tag === 'p') {
      if (hasPageBreak(element)) {
        pageBreakPositions.push(position);
      }

      const text = paragraphText(element);
      if (text) {
        elements.push([position, text]);
        position += 1;
      }

      if (processImages && visionClient) {
        const embeds: string[] = [];
        collectBlipEmbeds(element, embeds);
        for (const embedId of embeds) {
          if (imageRels.has(embedId) && !processedRids.has(embedId)) {
            processedRids.add(embedId);
            const imageBytes = imageRels.get(embedId);
            if (imageBytes) {
              const description = await describeImageBytes(
                imageBytes,
                semaphore,
                visionClient,
              );
              if (description) {
                elements.push([position, `[Image: ${description}]`]);
                visionUsed = true;
                position += 1;
              }
            }
          }
        }
      }
    } else if (tag === 'tbl') {
      const tableText = extractTableText(tableRows(element));
      if (tableText) {
        elements.push([position, `[Table]\n${tableText}`]);
        position += 1;
      }
    }
  }

  // Any images not referenced inline.
  if (processImages && visionClient) {
    for (const [rid, imageBytes] of imageRels) {
      if (!processedRids.has(rid)) {
        const description = await describeImageBytes(
          imageBytes,
          semaphore,
          visionClient,
        );
        if (description) {
          elements.push([position, `[Image: ${description}]`]);
          visionUsed = true;
          position += 1;
        }
      }
    }
  }

  // Headers and footers, deduplicated.
  const { headers, footers } = await extractHeadersFooters(zip);

  let headerPosition = -headers.length;
  for (const headerText of headers) {
    elements.push([headerPosition, `[Header]\n${headerText}`]);
    headerPosition += 1;
  }
  for (const footerText of footers) {
    elements.push([position, `[Footer]\n${footerText}`]);
    position += 1;
  }

  elements.sort((a, b) => a[0] - b[0]);
  const content = elements.map((el) => el[1]).join('\n\n');

  console.info(
    `DOCX processing complete: ${elements.length} elements, Vision API used: ${visionUsed}`,
  );
  void filename;

  return [content, visionUsed, pageBreakPositions];
}

async function extractHeadersFooters(
  zip: GuardedZip,
): Promise<{ headers: string[]; footers: string[] }> {
  const headers: string[] = [];
  const footers: string[] = [];
  const seenHeaders = new Set<string>();
  const seenFooters = new Set<string>();

  const partText = async (path: string): Promise<string> => {
    const xml = await zip.readString(path);
    if (!xml) {
      return '';
    }
    const tree = parser.parse(xml);
    const lines: string[] = [];
    const walk = (nodes: XmlNode[]): void => {
      for (const node of nodes) {
        if (localName(tagOf(node)) === 'p') {
          const text = paragraphText(node);
          if (text) {
            lines.push(text);
          }
        } else {
          walk(childrenOf(node));
        }
      }
    };
    walk(tree);
    return lines.join('\n');
  };

  for (const name of zip.names().sort()) {
    const match = /^word\/(header|footer)\d*\.xml$/.exec(name);
    if (!match) {
      continue;
    }
    const text = await partText(name);
    if (!text) {
      continue;
    }
    if (match[1] === 'header') {
      if (!seenHeaders.has(text)) {
        seenHeaders.add(text);
        headers.push(text);
      }
    } else if (!seenFooters.has(text)) {
      seenFooters.add(text);
      footers.push(text);
    }
  }

  return { headers, footers };
}
