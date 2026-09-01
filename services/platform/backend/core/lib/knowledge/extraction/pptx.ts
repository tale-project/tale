'use node';

/**
 * Smart PPTX text extraction with Vision API support.
 *
 * Parses the OOXML slide parts into a small shape abstraction, preserving the
 * relative position of shapes within each slide (ordered by their vertical
 * offset), recursing into groups, and reading tables, text, pictures, and
 * notes — matching the previous python-pptx implementation.
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

export type ShapeType = 'text' | 'table' | 'picture' | 'group' | 'other';

/** A minimal shape abstraction shared by the OOXML reader and unit tests. */
export interface Shape {
  shapeType: ShapeType;
  top: number;
  hasTextFrame: boolean;
  textParagraphs: string[];
  hasTable: boolean;
  tableRows: string[][];
  /** Embedded picture bytes (only for `picture` shapes that resolve). */
  imageBytes?: Uint8Array | null;
  /** Child shapes for `group` shapes. */
  shapes?: Shape[];
}

export interface Slide {
  shapes: Shape[];
  notes: string | null;
}

/** Recursively yield all shapes, descending into groups. */
export function* iterShapes(shapes: Shape[]): Generator<Shape> {
  for (const shape of shapes) {
    if (shape.shapeType === 'group') {
      yield* iterShapes(shape.shapes ?? []);
    } else {
      yield shape;
    }
  }
}

function localName(tag: string): string {
  const idx = tag.indexOf(':');
  return idx === -1 ? tag : tag.slice(idx + 1);
}

function tagOf(node: XmlNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== '#text') {
      return key;
    }
  }
  return '';
}

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

/** Collect `a:t` text grouped per `a:p` paragraph under a node. */
function collectParagraphs(node: XmlNode): string[] {
  const paragraphs: string[] = [];
  const walk = (n: XmlNode): void => {
    if (localName(tagOf(n)) === 'p') {
      paragraphs.push(collectRunText(n).trim());
      return;
    }
    for (const child of childrenOf(n)) {
      walk(child);
    }
  };
  walk(node);
  return paragraphs.filter((p) => p.length > 0);
}

function collectRunText(node: XmlNode): string {
  let text = '';
  if (localName(tagOf(node)) === 't') {
    for (const child of childrenOf(node)) {
      if (typeof child['#text'] === 'string') {
        text += child['#text'];
      }
    }
    return text;
  }
  for (const child of childrenOf(node)) {
    text += collectRunText(child);
  }
  return text;
}

function findOffset(spNode: XmlNode): number {
  // <p:spPr><a:xfrm><a:off y="..."/></a:xfrm></p:spPr>
  let top = 0;
  const walk = (n: XmlNode): void => {
    if (localName(tagOf(n)) === 'off') {
      const y = attrs(n)['@_y'];
      if (y !== undefined) {
        top = Number(y) || 0;
      }
    }
    for (const child of childrenOf(n)) {
      walk(child);
    }
  };
  walk(spNode);
  return top;
}

function tableFromGraphicFrame(node: XmlNode): string[][] | null {
  let table: XmlNode | null = null;
  const find = (n: XmlNode): void => {
    if (localName(tagOf(n)) === 'tbl') {
      table = n;
      return;
    }
    for (const child of childrenOf(n)) {
      find(child);
    }
  };
  find(node);
  if (!table) {
    return null;
  }
  const rows: string[][] = [];
  for (const child of childrenOf(table)) {
    if (localName(tagOf(child)) === 'tr') {
      const cells: string[] = [];
      for (const cell of childrenOf(child)) {
        if (localName(tagOf(cell)) === 'tc') {
          cells.push(collectRunText(cell).trim());
        }
      }
      rows.push(cells);
    }
  }
  return rows;
}

function blipEmbedId(node: XmlNode): string | null {
  let id: string | null = null;
  const walk = (n: XmlNode): void => {
    if (localName(tagOf(n)) === 'blip') {
      id = attrs(n)['@_r:embed'] ?? null;
    }
    for (const child of childrenOf(n)) {
      walk(child);
    }
  };
  walk(node);
  return id;
}

async function buildShapes(
  nodes: XmlNode[],
  rels: Map<string, string>,
  zip: GuardedZip,
): Promise<Shape[]> {
  const shapes: Shape[] = [];
  for (const node of nodes) {
    const tag = localName(tagOf(node));
    const top = findOffset(node);

    if (tag === 'grpSp') {
      shapes.push({
        shapeType: 'group',
        top,
        hasTextFrame: false,
        textParagraphs: [],
        hasTable: false,
        tableRows: [],
        shapes: await buildShapes(childrenOf(node), rels, zip),
      });
    } else if (tag === 'graphicFrame') {
      const rows = tableFromGraphicFrame(node);
      if (rows) {
        shapes.push({
          shapeType: 'table',
          top,
          hasTextFrame: false,
          textParagraphs: [],
          hasTable: true,
          tableRows: rows,
        });
      }
    } else if (tag === 'pic') {
      const embed = blipEmbedId(node);
      const target = embed ? rels.get(embed) : undefined;
      let bytes: Uint8Array | null = null;
      if (target) {
        const path = `ppt/${target.replace(/^\.\.\//, '')}`;
        bytes = await zip.readBytes(path);
      }
      shapes.push({
        shapeType: 'picture',
        top,
        hasTextFrame: false,
        textParagraphs: [],
        hasTable: false,
        tableRows: [],
        imageBytes: bytes,
      });
    } else if (tag === 'sp') {
      const paragraphs = collectParagraphs(node);
      shapes.push({
        shapeType: 'text',
        top,
        hasTextFrame: paragraphs.length > 0,
        textParagraphs: paragraphs,
        hasTable: false,
        tableRows: [],
      });
    }
  }
  return shapes;
}

/**
 * Process one slide's shapes into ordered text. Returns
 * `[slideNum, slideText, visionUsed]`. Exported for unit testing the shape walk.
 */
export async function processSlide(
  slideNum: number,
  slide: Slide,
  semaphore: Semaphore,
  visionClient: VisionClient | null,
  processImages: boolean,
): Promise<[number, string, boolean]> {
  const elements: [number, string][] = [];
  const imageTasks: [number, Uint8Array][] = [];

  for (const shape of iterShapes(slide.shapes)) {
    const top = shape.top || 0;

    if (shape.hasTextFrame && shape.textParagraphs.length > 0) {
      elements.push([top, shape.textParagraphs.join('\n')]);
    }

    if (shape.hasTable) {
      const tableText = extractTableText(shape.tableRows);
      if (tableText) {
        elements.push([top, `[Table]\n${tableText}`]);
      }
    }

    if (
      processImages &&
      visionClient &&
      shape.shapeType === 'picture' &&
      shape.imageBytes
    ) {
      imageTasks.push([top, shape.imageBytes]);
    }
  }

  let visionUsed = false;
  if (imageTasks.length > 0 && visionClient) {
    const results = await Promise.all(
      imageTasks.map(([, imgBytes]) =>
        describeImageBytes(imgBytes, semaphore, visionClient).catch(
          (err: unknown) => {
            console.warn(
              `Failed to describe image on slide ${slideNum}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            return '';
          },
        ),
      ),
    );
    results.forEach((description, i) => {
      if (description) {
        elements.push([imageTasks[i][0], `[Image: ${description}]`]);
        visionUsed = true;
      }
    });
  }

  if (slide.notes && slide.notes.trim()) {
    elements.push([Number.POSITIVE_INFINITY, `[Notes]\n${slide.notes.trim()}`]);
  }

  elements.sort((a, b) => a[0] - b[0]);
  const content = elements.map((el) => el[1]).join('\n\n');
  return [slideNum, `--- Slide ${slideNum} ---\n${content}`, visionUsed];
}

function parseRelationships(xml: string): Map<string, string> {
  const tree = parser.parse(xml);
  const map = new Map<string, string>();
  const walk = (nodes: XmlNode[]): void => {
    for (const node of nodes) {
      if (localName(tagOf(node)) === 'Relationship') {
        const a = attrs(node);
        if (a['@_Id'] && a['@_Target']) {
          map.set(a['@_Id'], a['@_Target']);
        }
      }
      walk(childrenOf(node));
    }
  };
  walk(tree);
  return map;
}

function slideNumber(name: string): number {
  const match = /slide(\d+)\.xml$/.exec(name);
  return match ? Number(match[1]) : 0;
}

export interface PptxExtractionOptions {
  visionClient?: VisionClient | null;
  processImages?: boolean;
  maxConcurrent?: number;
}

/**
 * Extract text from PPTX bytes with optional Vision support. Returns
 * `[text, visionUsed]`. Throws on an invalid/corrupt archive.
 */
export async function extractTextFromPptxBytes(
  pptxBytes: Uint8Array,
  filename = 'presentation.pptx',
  options: PptxExtractionOptions = {},
): Promise<[string, boolean]> {
  const visionClient = options.visionClient ?? null;
  const processImages = options.processImages ?? true;
  const maxConcurrent = options.maxConcurrent ?? 3;

  const zip = await GuardedZip.load(pptxBytes);
  const semaphore = new Semaphore(maxConcurrent);

  const slideNames = zip
    .names()
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (slideNames.length === 0) {
    throw new Error('Invalid or corrupt file');
  }

  const slidesContent: [number, string][] = [];
  let visionUsed = false;

  for (const slideName of slideNames) {
    const num = slideNumber(slideName);
    const xml = await zip.readString(slideName);
    if (!xml) {
      continue;
    }

    const relsName = slideName.replace(
      /slides\/(slide\d+)\.xml$/,
      'slides/_rels/$1.xml.rels',
    );
    const relsXml = await zip.readString(relsName);
    const rels = relsXml
      ? parseRelationships(relsXml)
      : new Map<string, string>();

    const tree = parser.parse(xml);
    let spTree: XmlNode[] = [];
    const findSpTree = (nodes: XmlNode[]): void => {
      for (const node of nodes) {
        if (localName(tagOf(node)) === 'spTree') {
          spTree = childrenOf(node);
          return;
        }
        findSpTree(childrenOf(node));
      }
    };
    findSpTree(tree);

    const shapes = await buildShapes(spTree, rels, zip);
    const notes = await readSlideNotes(zip, relsName, relsXml);

    const [, slideText, slideVisionUsed] = await processSlide(
      num,
      { shapes, notes },
      semaphore,
      visionClient,
      processImages,
    );
    slidesContent.push([num, slideText]);
    if (slideVisionUsed) {
      visionUsed = true;
    }
  }

  slidesContent.sort((a, b) => a[0] - b[0]);
  void filename;
  return [slidesContent.map((s) => s[1]).join('\n\n'), visionUsed];
}

async function readSlideNotes(
  zip: GuardedZip,
  relsName: string,
  relsXml: string | null,
): Promise<string | null> {
  if (!relsXml) {
    return null;
  }
  const tree = parser.parse(relsXml);
  let notesTarget: string | null = null;
  const walk = (nodes: XmlNode[]): void => {
    for (const node of nodes) {
      if (localName(tagOf(node)) === 'Relationship') {
        const a = attrs(node);
        if ((a['@_Type'] ?? '').endsWith('/notesSlide') && a['@_Target']) {
          notesTarget = a['@_Target'];
        }
      }
      walk(childrenOf(node));
    }
  };
  walk(tree);
  if (!notesTarget) {
    return null;
  }
  const base = relsName.replace(/_rels\/.*$/, '');
  const path = `${base}${(notesTarget as string).replace(/^\.\.\//, '../')}`
    .replace('slides/../', '')
    .replace(/^ppt\/slides\//, 'ppt/');
  const notesXml =
    (await zip.readString(
      `ppt/${(notesTarget as string).replace(/^\.\.\//, '')}`,
    )) ?? (await zip.readString(path));
  if (!notesXml) {
    return null;
  }
  const notesTree = parser.parse(notesXml);
  const paragraphs: string[] = [];
  for (const node of notesTree) {
    paragraphs.push(...collectParagraphs(node));
  }
  return paragraphs.join('\n');
}
