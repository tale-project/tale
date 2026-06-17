'use node';

/**
 * DOCX generation from structured content (and HTML/markdown → structured).
 *
 * Ports `services/crawler/app/services/docx_service.py` (python-docx) and
 * `html_to_docx_converter.py` (BeautifulSoup → sections). python-docx builds a
 * full OOXML package; here we assemble the minimal-but-valid `.docx` zip by
 * hand with `jszip`, emitting `word/document.xml` plus the required content-type
 * and relationship parts. Word's built-in styles ("Heading 1", "List Bullet",
 * "Title", etc.) are referenced by `w:pStyle` exactly as python-docx did — Word
 * resolves them against its default style table, so we do not need to ship a
 * `styles.xml` for the common cases (the Python code also relied on the default
 * template's styles via `add_heading` / `_try_apply_style`).
 *
 * // TODO(verify): python-docx's `Document()` ships a full default `styles.xml`
 * (Normal/Heading N/Title/List Bullet/List Number/Quote/Table Grid). We emit a
 * compact `styles.xml` covering those names so the `w:pStyle` references resolve
 * even in strict consumers; numbering (`numbering.xml`) for true auto-numbered
 * lists is NOT emitted — bullets/numbered render as styled paragraphs (matching
 * python-docx's behaviour, which also only applied the paragraph style and let
 * Word supply list formatting). Visual list markers therefore depend on the
 * consumer's style table. Flag if pixel-exact list numbering is required.
 */

import JSZip from 'jszip';

import { htmlToSections } from './html_to_sections';
import { markdownToHtml } from './markdown_to_html';

export type DocxSectionType =
  | 'heading'
  | 'paragraph'
  | 'bullets'
  | 'numbered'
  | 'table'
  | 'quote'
  | 'code';

export interface DocxSection {
  type: DocxSectionType;
  text?: string;
  level?: number;
  items?: string[];
  headers?: string[];
  rows?: string[][];
}

export interface DocxContent {
  title?: string;
  subtitle?: string;
  sections: DocxSection[];
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Escape text for inclusion in XML text/attribute content. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A single run, optionally bold. `xml:space="preserve"` keeps whitespace. */
function run(text: string, bold = false): string {
  const rpr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** A paragraph with optional style and alignment. */
function paragraph(
  text: string,
  opts: { style?: string; align?: 'center'; bold?: boolean } = {},
): string {
  const props: string[] = [];
  if (opts.style) {
    props.push(`<w:pStyle w:val="${escapeXml(opts.style)}"/>`);
  }
  if (opts.align) {
    props.push(`<w:jc w:val="${opts.align}"/>`);
  }
  const ppr = props.length > 0 ? `<w:pPr>${props.join('')}</w:pPr>` : '';
  const content = text.length > 0 ? run(text, opts.bold) : '';
  return `<w:p>${ppr}${content}</w:p>`;
}

/** Empty spacer paragraph. */
function emptyParagraph(): string {
  return '<w:p/>';
}

function headingStyle(level: number): string {
  // python-docx: add_heading(text, level=0) → "Title"; level N → "Heading N".
  if (level <= 0) {
    return 'Title';
  }
  const clamped = Math.min(Math.max(level, 1), 9);
  return `Heading${clamped}`;
}

function tableXml(headers: string[], rows: string[][]): string {
  if (headers.length === 0) {
    return '';
  }
  const cols = headers.length;
  const headerCells = headers
    .map(
      (h) =>
        `<w:tc><w:p><w:pPr><w:pStyle w:val="TableGrid"/></w:pPr>${run(
          h,
          true,
        )}</w:p></w:tc>`,
    )
    .join('');
  const headerRow = `<w:tr>${headerCells}</w:tr>`;

  const dataRows = rows
    .map((rowData) => {
      const cells: string[] = [];
      for (let i = 0; i < cols; i += 1) {
        const value = i < rowData.length ? rowData[i] : '';
        cells.push(`<w:tc><w:p>${run(value)}</w:p></w:tc>`);
      }
      return `<w:tr>${cells.join('')}</w:tr>`;
    })
    .join('');

  const tblPr =
    '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '</w:tblBorders></w:tblPr>';
  const grid = `<w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>`;
  return `<w:tbl>${tblPr}${grid}${headerRow}${dataRows}</w:tbl>`;
}

/** Render one section into paragraph/table XML. Mirrors `_process_section`. */
function sectionXml(section: DocxSection): string {
  switch (section.type) {
    case 'heading':
      return paragraph(section.text ?? '', {
        style: headingStyle(section.level ?? 1),
      });
    case 'paragraph':
      return paragraph(section.text ?? '');
    case 'bullets':
      return (section.items ?? [])
        .map((item) => paragraph(item, { style: 'ListBullet' }))
        .join('');
    case 'numbered':
      return (section.items ?? [])
        .map((item) => paragraph(item, { style: 'ListNumber' }))
        .join('');
    case 'table': {
      const tbl = tableXml(section.headers ?? [], section.rows ?? []);
      // python-docx adds a spacer paragraph after the table.
      return tbl ? `${tbl}${emptyParagraph()}` : '';
    }
    case 'quote':
      return paragraph(section.text ?? '', { style: 'Quote' });
    case 'code':
      return paragraph(section.text ?? '');
    default:
      return '';
  }
}

/** Build the `word/document.xml` body XML for the given content. */
function buildDocumentXml(content: DocxContent): string {
  const parts: string[] = [];

  // Title (python-docx: add_heading(title, level=0), centered).
  parts.push(
    paragraph(content.title ?? 'Untitled Document', {
      style: 'Title',
      align: 'center',
    }),
  );

  if (content.subtitle) {
    parts.push(paragraph(content.subtitle, { align: 'center' }));
    parts.push(emptyParagraph());
  }

  for (const section of content.sections) {
    parts.push(sectionXml(section));
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${parts.join('')}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`
  );
}

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

/** A compact styles part covering the built-in style names we reference. */
function buildStylesXml(): string {
  const heading = (n: number): string =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${28 - n * 2}"/></w:rPr></w:style>`;
  const headings = [1, 2, 3, 4, 5, 6].map(heading).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${W}">` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>` +
    headings +
    `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>` +
    `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>` +
    `</w:styles>`
  );
}

/** Generate DOCX bytes from structured content. Mirrors `generate_docx()`. */
export async function generateDocxBytes(
  content: DocxContent,
): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', ROOT_RELS_XML);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
  zip.file('word/styles.xml', buildStylesXml());
  zip.file('word/document.xml', buildDocumentXml(content));
  // Emit an ArrayBuffer-backed Uint8Array so callers can pass it straight to
  // `fetch`'s BodyInit / `Blob` without an ArrayBufferLike type mismatch.
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return new Uint8Array(buffer);
}

/** Convert HTML → DOCX bytes. Mirrors `html_to_docx()`. */
export async function htmlToDocxBytes(
  html: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return generateDocxBytes(htmlToSections(html));
}

/** Convert markdown → DOCX bytes. Mirrors `markdown_to_docx()`. */
export async function markdownToDocxBytes(
  markdown: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return htmlToDocxBytes(markdownToHtml(markdown));
}
