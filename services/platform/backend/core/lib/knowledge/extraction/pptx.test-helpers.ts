// PPTX bytes built by hand, for the suites that read a deck. Test-only:
// never imported by shipped code.

import JSZip from 'jszip';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';

export function buildSlideXml(paragraphs: string[]): string {
  const shapes = paragraphs
    .map(
      (text) =>
        `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`,
    )
    .join('');
  return `<?xml version="1.0"?><p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
}

export function buildTableSlideXml(rows: string[][]): string {
  const trs = rows
    .map(
      (cells) =>
        `<a:tr>${cells.map((c) => `<a:tc><a:txBody><a:p><a:r><a:t>${c}</a:t></a:r></a:p></a:txBody></a:tc>`).join('')}</a:tr>`,
    )
    .join('');
  const tbl = `<a:graphic><a:graphicData><a:tbl>${trs}</a:tbl></a:graphicData></a:graphic>`;
  return `<?xml version="1.0"?><p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:graphicFrame>${tbl}</p:graphicFrame></p:spTree></p:cSld></p:sld>`;
}

export async function buildPptx(slides: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  slides.forEach((xml, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
  });
  return zip.generateAsync({ type: 'uint8array' });
}
