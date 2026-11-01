// DOCX bytes built by hand, for the suites that read a DOCX. Test-only:
// never imported by shipped code.

import JSZip from 'jszip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function para(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

export async function buildDocx(
  bodyXml: string,
  extra: { headers?: string[]; footers?: string[] } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  const documentXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  zip.file('word/document.xml', documentXml);
  (extra.headers ?? []).forEach((text, i) => {
    zip.file(
      `word/header${i + 1}.xml`,
      `<?xml version="1.0"?><w:hdr xmlns:w="${W}">${para(text)}</w:hdr>`,
    );
  });
  (extra.footers ?? []).forEach((text, i) => {
    zip.file(
      `word/footer${i + 1}.xml`,
      `<?xml version="1.0"?><w:ftr xmlns:w="${W}">${para(text)}</w:ftr>`,
    );
  });
  return zip.generateAsync({ type: 'uint8array' });
}
