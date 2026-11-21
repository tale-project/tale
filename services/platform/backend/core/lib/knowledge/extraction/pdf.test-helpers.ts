// PDF bytes built by hand, for the suites that read a PDF: enough for pdf.js
// to extract the text, with no PDF library. Test-only: never imported by
// shipped code.

import { deflateSync } from 'node:zlib';

/**
 * Build a minimal single-page PDF whose content stream shows `text` via a
 * standard Helvetica font. Enough for pdfjs to extract the text — no external
 * PDF library needed.
 */
export function makeTextPdf(text: string): Uint8Array<ArrayBuffer> {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  const stream = `BT /F1 24 Tf 72 700 Td (${escaped}) Tj ET`;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

/** A PDF of `count` pages, each showing one short line: a document longer
 * than the extractor reads. */
export function makePagedPdf(count: number): Uint8Array<ArrayBuffer> {
  const pageIds = Array.from({ length: count }, (_, i) => 4 + i * 2);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${count} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let page = 1; page <= count; page++) {
    const stream = `BT /F1 12 Tf 72 700 Td (Page ${page}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

/** One page of {@link makeIllustratedPdf}. */
export interface IllustratedPage {
  /** Lines of text shown on the page. */
  text?: string[];
  /** A picture: how many pixels it holds, how large it is painted in
   * points (a page is 595 by 842), and how many bytes its stream is padded
   * to, for a page that is heavy to load. */
  image?: {
    pixels: [number, number];
    painted: [number, number];
    padToBytes?: number;
  };
}

/**
 * A PDF whose pages show text, a picture, or both. A picture is an 8-bit RGB
 * image behind FlateDecode: what pdf.js has to hold to decode it is its
 * pixels times three, as for a photograph of that size.
 */
export function makeIllustratedPdf(
  pages: IllustratedPage[],
): Uint8Array<ArrayBuffer> {
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Buffer): void => {
    const buffer =
      typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
    chunks.push(buffer);
    length += buffer.length;
  };
  // 1 catalog, 2 pages, 3 font; then, per page: content, picture, page.
  let nextId = 4;
  const object = (body: string, stream?: Buffer): number => {
    const id = nextId;
    nextId += 1;
    offsets[id] = length;
    if (stream === undefined) push(`${id} 0 obj\n${body}\nendobj\n`);
    else {
      push(`${id} 0 obj\n${body}\nstream\n`);
      push(stream);
      push('\nendstream\nendobj\n');
    }
    return id;
  };

  push('%PDF-1.5\n');
  const pageIds: number[] = [];
  for (const page of pages) {
    let content = '';
    let resources = '/Font << /F1 3 0 R >>';
    if (page.text !== undefined && page.text.length > 0) {
      content += 'BT /F1 10 Tf 12 TL 56 760 Td\n';
      for (const line of page.text) {
        const escaped = line
          .replace(/\\/g, '\\\\')
          .replace(/\(/g, '\\(')
          .replace(/\)/g, '\\)');
        content += `(${escaped}) Tj T*\n`;
      }
      content += 'ET\n';
    }
    if (page.image !== undefined) {
      const [width, height] = page.image.pixels;
      const [paintedWidth, paintedHeight] = page.image.painted;
      // One flat colour: it deflates to almost nothing, and still decodes
      // to every one of its pixels.
      let data = deflateSync(Buffer.alloc(width * height * 3, 0x7f));
      let filter = '/Filter /FlateDecode ';
      if (page.image.padToBytes !== undefined) {
        // Stored as it is, so that its stream is as long as asked.
        data = Buffer.alloc(page.image.padToBytes, 0x7f);
        filter = '';
      }
      const imageId = object(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${filter}/Length ${data.length} >>`,
        data,
      );
      resources += ` /XObject << /Im1 ${imageId} 0 R >>`;
      content += `q ${paintedWidth} 0 0 ${paintedHeight} 0 0 cm /Im1 Do Q\n`;
    }
    const stream = Buffer.from(content, 'latin1');
    const contentId = object(`<< /Length ${stream.length} >>`, stream);
    pageIds.push(
      object(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << ${resources} >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }

  const total = nextId;
  nextId = 1;
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  object('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const xref = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id += 1) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return new Uint8Array(Buffer.concat(chunks));
}
