import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { generateDocxBytes } from './docx_generate';
import { applyStructured, extractStructured } from './docx_roundtrip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function para(text: string, extraChildren = ''): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r>${extraChildren}</w:p>`;
}

function multiRunPara(parts: string[]): string {
  const runs = parts
    .map((p) => `<w:r><w:t xml:space="preserve">${p}</w:t></w:r>`)
    .join('');
  return `<w:p>${runs}</w:p>`;
}

function table(rows: string[][]): string {
  const trs = rows
    .map(
      (cells) =>
        `<w:tr>${cells
          .map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`)
          .join('')}</w:tr>`,
    )
    .join('');
  return `<w:tbl>${trs}</w:tbl>`;
}

async function buildDocx(bodyXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  const documentXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  zip.file('word/document.xml', documentXml);
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new Uint8Array(buf);
}

async function readDocumentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('word/document.xml');
  return file ? file.async('string') : '';
}

describe('extractStructured', () => {
  it('extracts paragraph keys, text and a stable source hash', async () => {
    const bytes = await buildDocx(para('Hello') + para('World'));
    const result = await extractStructured(bytes);
    expect(result.metadata.paragraph_count).toBe(2);
    expect(result.lightweight.map((p) => p.key)).toEqual(['p_0', 'p_1']);
    expect(result.lightweight.map((p) => p.text)).toEqual(['Hello', 'World']);
    expect(result.source_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks empty paragraphs not editable', async () => {
    const bytes = await buildDocx(para('Real') + '<w:p/>');
    const result = await extractStructured(bytes);
    expect(result.lightweight[1].editable).toBe(false);
  });

  it('marks paragraphs containing hyperlinks not editable', async () => {
    const risky = `<w:p><w:hyperlink><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>`;
    const bytes = await buildDocx(para('Plain') + risky);
    const result = await extractStructured(bytes);
    expect(result.lightweight[0].editable).toBe(true);
    expect(result.lightweight[1].editable).toBe(false);
  });

  it('keys table-cell paragraphs and shares the paragraph counter', async () => {
    const bytes = await buildDocx(
      para('Intro') +
        table([
          ['A', 'B'],
          ['C', 'D'],
        ]),
    );
    const result = await extractStructured(bytes);
    expect(result.metadata.table_count).toBe(1);
    const keys = result.lightweight.map((p) => p.key);
    expect(keys).toContain('p_0');
    expect(keys).toContain('tbl_0_r0_c0_p0');
    expect(keys).toContain('tbl_0_r1_c1_p0');
    // p_counter advanced for the table cells too (Python parity).
    expect(result.metadata.paragraph_count).toBe(5);
  });
});

describe('applyStructured', () => {
  it('rejects a source-hash mismatch', async () => {
    const bytes = await buildDocx(para('Hello'));
    await expect(
      applyStructured(bytes, 'deadbeef', [{ key: 'p_0', text: 'x' }]),
    ).rejects.toThrow('Source hash mismatch');
  });

  it('applies a plain text replacement', async () => {
    const bytes = await buildDocx(para('Hello') + para('World'));
    const extracted = await extractStructured(bytes);
    const applied = await applyStructured(bytes, extracted.source_hash, [
      { key: 'p_0', text: 'Goodbye' },
    ]);
    expect(applied.report.applied).toBe(1);
    const xml = await readDocumentXml(applied.bytes);
    expect(xml).toContain('Goodbye');
    expect(xml).not.toContain('>Hello<');
  });

  it('reports unknown keys', async () => {
    const bytes = await buildDocx(para('Hello'));
    const extracted = await extractStructured(bytes);
    const applied = await applyStructured(bytes, extracted.source_hash, [
      { key: 'p_99', text: 'x' },
    ]);
    expect(applied.report.skipped_unknown_key).toEqual(['p_99']);
    expect(applied.report.applied).toBe(0);
  });

  it('reports no-change when text is identical', async () => {
    const bytes = await buildDocx(para('Same'));
    const extracted = await extractStructured(bytes);
    const applied = await applyStructured(bytes, extracted.source_hash, [
      { key: 'p_0', text: 'Same' },
    ]);
    expect(applied.report.skipped_no_change).toEqual(['p_0']);
  });

  it('flags format_simplified when collapsing multiple runs', async () => {
    const bytes = await buildDocx(multiRunPara(['Hello ', 'World']));
    const extracted = await extractStructured(bytes);
    const applied = await applyStructured(bytes, extracted.source_hash, [
      { key: 'p_0', text: 'Brand new text' },
    ]);
    expect(applied.report.applied).toBe(1);
    expect(applied.report.format_simplified).toEqual(['p_0']);
  });

  it('applies modifications inside table cells', async () => {
    const bytes = await buildDocx(
      table([
        ['A', 'B'],
        ['C', 'D'],
      ]),
    );
    const extracted = await extractStructured(bytes);
    const applied = await applyStructured(bytes, extracted.source_hash, [
      { key: 'tbl_0_r0_c0_p0', text: 'Z' },
    ]);
    expect(applied.report.applied).toBe(1);
    const xml = await readDocumentXml(applied.bytes);
    expect(xml).toContain('Z');
  });

  it('round-trips generated documents (generate → extract → apply → extract)', async () => {
    const bytes = await generateDocxBytes({
      title: 'Doc',
      sections: [
        { type: 'paragraph', text: 'First paragraph' },
        { type: 'paragraph', text: 'Second paragraph' },
      ],
    });
    const extracted = await extractStructured(bytes);
    const target = extracted.lightweight.find(
      (p) => p.text === 'First paragraph',
    );
    expect(target).toBeDefined();
    const applied = await applyStructured(bytes, extracted.source_hash, [
      { key: target?.key ?? '', text: 'Edited paragraph' },
    ]);
    expect(applied.report.applied).toBe(1);
    const re = await extractStructured(applied.bytes);
    expect(re.lightweight.some((p) => p.text === 'Edited paragraph')).toBe(
      true,
    );
    expect(re.lightweight.some((p) => p.text === 'First paragraph')).toBe(
      false,
    );
  });
});

describe('applyStructured with tracked changes', () => {
  it('emits w:ins / w:del revision markup', async () => {
    const bytes = await buildDocx(para('The quick brown fox'));
    const extracted = await extractStructured(bytes);
    const applied = await applyStructured(
      bytes,
      extracted.source_hash,
      [{ key: 'p_0', text: 'The slow brown fox' }],
      { trackChanges: true, author: 'Tester' },
    );
    expect(applied.report.applied).toBe(1);
    const xml = await readDocumentXml(applied.bytes);
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('<w:del');
    expect(xml).toContain('w:author="Tester"');
    // The deleted word becomes delText; the inserted word a normal run.
    expect(xml).toContain('<w:delText');
    expect(xml).toContain('slow');
    expect(xml).toContain('quick');
  });

  it('uses a whole-paragraph del+ins for very dissimilar text', async () => {
    const bytes = await buildDocx(para('aaaaa'));
    const extracted = await extractStructured(bytes);
    const applied = await applyStructured(
      bytes,
      extracted.source_hash,
      [{ key: 'p_0', text: 'zzzzzzzzzz' }],
      { trackChanges: true },
    );
    expect(applied.report.applied).toBe(1);
    const xml = await readDocumentXml(applied.bytes);
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('<w:del');
    expect(xml).toContain('zzzzzzzzzz');
  });

  it('preserves the unchanged prefix as a plain run', async () => {
    const bytes = await buildDocx(para('Hello world'));
    const extracted = await extractStructured(bytes);
    const applied = await applyStructured(
      bytes,
      extracted.source_hash,
      [{ key: 'p_0', text: 'Hello there' }],
      { trackChanges: true },
    );
    const xml = await readDocumentXml(applied.bytes);
    expect(xml).toContain('Hello');
    expect(xml).toContain('there');
    expect(xml).toContain('<w:del');
  });
});

describe('file safety', () => {
  it('rejects OLE (legacy .doc / encrypted) files', async () => {
    const ole = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00,
    ]);
    await expect(extractStructured(ole)).rejects.toThrow(
      'Encrypted or legacy .doc',
    );
  });

  it('rejects .docm by filename', async () => {
    const bytes = await buildDocx(para('x'));
    await expect(extractStructured(bytes, 'macro.docm')).rejects.toThrow(
      'Macro-enabled',
    );
  });
});
