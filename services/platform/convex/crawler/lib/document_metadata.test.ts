import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  extractDocumentMetadata,
  extractOoxmlMetadata,
  parsePdfDate,
} from './document_metadata';

const CORE_NS =
  'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:dcterms="http://purl.org/dc/terms/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

async function buildOoxml(coreXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('docProps/core.xml', coreXml);
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new Uint8Array(buf);
}

describe('parsePdfDate', () => {
  it('parses a full PDF date with timezone offset', () => {
    // D:2023-06-15 12:30:00 +02:00 → UTC 10:30:00.
    const ms = parsePdfDate("D:20230615123000+02'00'");
    expect(ms).toBe(Date.UTC(2023, 5, 15, 10, 30, 0));
  });

  it('parses a Z (UTC) date', () => {
    const ms = parsePdfDate('D:20230615123000Z');
    expect(ms).toBe(Date.UTC(2023, 5, 15, 12, 30, 0));
  });

  it('parses a bare year-month-day', () => {
    const ms = parsePdfDate('20230615');
    expect(ms).toBe(Date.UTC(2023, 5, 15, 0, 0, 0));
  });

  it('returns null for out-of-range years', () => {
    expect(parsePdfDate('D:18000101000000Z')).toBeNull();
    expect(parsePdfDate('D:25000101000000Z')).toBeNull();
  });

  it('returns null for empty / malformed / non-string input', () => {
    expect(parsePdfDate(null)).toBeNull();
    expect(parsePdfDate(undefined)).toBeNull();
    expect(parsePdfDate('')).toBeNull();
    expect(parsePdfDate('not-a-date')).toBeNull();
  });

  it('handles a negative timezone offset', () => {
    const ms = parsePdfDate("D:20230615060000-05'00'");
    expect(ms).toBe(Date.UTC(2023, 5, 15, 11, 0, 0));
  });
});

describe('extractOoxmlMetadata', () => {
  it('reads title, author and dates from core.xml', async () => {
    const core = `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}><dc:title>My Title</dc:title><dc:creator>Jane Doe</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2022-01-02T03:04:05Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2023-02-03T04:05:06Z</dcterms:modified></cp:coreProperties>`;
    const meta = await extractOoxmlMetadata(await buildOoxml(core));
    expect(meta.title).toBe('My Title');
    expect(meta.author).toBe('Jane Doe');
    expect(meta.createdAt).toBe(Date.UTC(2022, 0, 2, 3, 4, 5));
    expect(meta.modifiedAt).toBe(Date.UTC(2023, 1, 3, 4, 5, 6));
    expect(meta.scannedPagesDetected).toBe(0);
  });

  it('returns null fields when core.xml is missing', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<x/>');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const meta = await extractOoxmlMetadata(new Uint8Array(buf));
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.createdAt).toBeNull();
  });

  it('tolerates empty title/author elements', async () => {
    const core = `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}><dc:title></dc:title></cp:coreProperties>`;
    const meta = await extractOoxmlMetadata(await buildOoxml(core));
    expect(meta.title).toBeNull();
    expect(meta.author).toBeNull();
  });

  it('does not throw on corrupt bytes', async () => {
    const meta = await extractOoxmlMetadata(new Uint8Array([1, 2, 3, 4]));
    expect(meta.title).toBeNull();
  });
});

describe('extractDocumentMetadata dispatch', () => {
  it('routes docx/pptx to OOXML extraction', async () => {
    const core = `<?xml version="1.0"?><cp:coreProperties ${CORE_NS}><dc:title>Routed</dc:title></cp:coreProperties>`;
    const meta = await extractDocumentMetadata(await buildOoxml(core), 'docx');
    expect(meta.title).toBe('Routed');
  });

  it('returns empty metadata for unknown extensions', async () => {
    const meta = await extractDocumentMetadata(new Uint8Array([0]), 'txt');
    expect(meta).toEqual({
      title: null,
      author: null,
      pageCount: null,
      createdAt: null,
      modifiedAt: null,
      scannedPagesDetected: 0,
    });
  });
});
