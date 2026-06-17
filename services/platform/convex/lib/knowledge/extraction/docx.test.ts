import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { extractTextFromDocxBytes } from './docx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function para(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function paraWithPageBreakBefore(text: string): string {
  return `<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function paraWithInlineBreak(text: string): string {
  return `<w:p><w:r><w:br w:type="page"/><w:t>${text}</w:t></w:r></w:p>`;
}

function table(rows: string[][]): string {
  const trs = rows
    .map(
      (cells) =>
        `<w:tr>${cells.map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl>${trs}</w:tbl>`;
}

async function buildDocx(
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

describe('extractTextFromDocxBytes', () => {
  it('extracts basic paragraph text', async () => {
    const [text, visionUsed] = await extractTextFromDocxBytes(
      await buildDocx(para('Hello World')),
    );
    expect(text).toContain('Hello World');
    expect(visionUsed).toBe(false);
  });

  it('extracts multiple paragraphs', async () => {
    const body =
      para('First paragraph') +
      para('Second paragraph') +
      para('Third paragraph');
    const [text] = await extractTextFromDocxBytes(await buildDocx(body));
    expect(text).toContain('First paragraph');
    expect(text).toContain('Second paragraph');
    expect(text).toContain('Third paragraph');
  });

  it('extracts a table', async () => {
    const [text] = await extractTextFromDocxBytes(
      await buildDocx(
        table([
          ['A1', 'B1'],
          ['A2', 'B2'],
        ]),
      ),
    );
    expect(text).toContain('A1');
    expect(text).toContain('B1');
    expect(text).toContain('[Table]');
  });

  it('places the header before the body', async () => {
    const [text] = await extractTextFromDocxBytes(
      await buildDocx(para('Body text'), { headers: ['My Header'] }),
    );
    expect(text).toContain('[Header]');
    expect(text).toContain('My Header');
    expect(text.indexOf('[Header]')).toBeLessThan(text.indexOf('Body text'));
  });

  it('places the footer after the body', async () => {
    const [text] = await extractTextFromDocxBytes(
      await buildDocx(para('Body text'), { footers: ['My Footer'] }),
    );
    expect(text).toContain('[Footer]');
    expect(text).toContain('My Footer');
    expect(text.indexOf('Body text')).toBeLessThan(text.indexOf('[Footer]'));
  });

  it('orders header < body < footer', async () => {
    const [text] = await extractTextFromDocxBytes(
      await buildDocx(para('Middle content'), {
        headers: ['Doc Header'],
        footers: ['Doc Footer'],
      }),
    );
    expect(text.indexOf('Doc Header')).toBeLessThan(
      text.indexOf('Middle content'),
    );
    expect(text.indexOf('Middle content')).toBeLessThan(
      text.indexOf('Doc Footer'),
    );
  });

  it('deduplicates identical headers', async () => {
    const [text] = await extractTextFromDocxBytes(
      await buildDocx(para('Page one'), {
        headers: ['Same Header', 'Same Header'],
      }),
    );
    expect(text.split('[Header]\nSame Header').length - 1).toBe(1);
  });
});

describe('page break detection', () => {
  it('reports no page breaks for plain text', async () => {
    const [, , breaks] = await extractTextFromDocxBytes(
      await buildDocx(para('Simple text')),
    );
    expect(breaks).toEqual([]);
  });

  it('detects an inline page break', async () => {
    const body =
      para('Page one content') +
      paraWithInlineBreak('Page two content') +
      para('After break');
    const [text, , breaks] = await extractTextFromDocxBytes(
      await buildDocx(body),
    );
    expect(breaks.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain('Page one content');
    expect(text).toContain('After break');
  });

  it('detects a pageBreakBefore style', async () => {
    const body = para('First page') + paraWithPageBreakBefore('Second page');
    const [text, , breaks] = await extractTextFromDocxBytes(
      await buildDocx(body),
    );
    expect(breaks.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain('First page');
    expect(text).toContain('Second page');
  });

  it('counts multiple page breaks', async () => {
    const body =
      para('Page 1') +
      paraWithInlineBreak('Page 2') +
      para('Still page 2') +
      paraWithInlineBreak('Page 3');
    const [, , breaks] = await extractTextFromDocxBytes(await buildDocx(body));
    expect(breaks).toHaveLength(2);
  });

  it('does not change the text when page breaks are present', async () => {
    const plain = para('Hello') + para('World');
    const withBreak = para('Hello') + paraWithPageBreakBefore('World');
    const [text1, , breaks1] = await extractTextFromDocxBytes(
      await buildDocx(plain),
    );
    const [text2, , breaks2] = await extractTextFromDocxBytes(
      await buildDocx(withBreak),
    );
    expect(text1).toBe(text2);
    expect(breaks1).toEqual([]);
    expect(breaks2.length).toBeGreaterThanOrEqual(1);
  });
});
