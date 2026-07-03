import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { extractTextFromOdtBytes } from './odt';

// The exact `content.xml` of the provided sample.odt fixture (heading +
// paragraph + a 2-item list + a 2x2 table). Embedded rather than read from
// disk because these tests run under convex-test's edge-runtime, which has no
// `fs` — the same reason the sibling docx/pptx tests build their archives
// in-process with JSZip.
const SAMPLE_CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2">
 <office:body><office:text>
  <text:h text:outline-level="1">Sample ODT Test Document</text:h>
  <text:p>This paragraph proves ODT text extraction works.</text:p>
  <text:list><text:list-item><text:p>First requirement</text:p></text:list-item><text:list-item><text:p>Second requirement</text:p></text:list-item></text:list>
  <table:table table:name="T1">
   <table:table-row><table:table-cell><text:p>Cell A1</text:p></table:table-cell><table:table-cell><text:p>Cell B1</text:p></table:table-cell></table:table-row>
   <table:table-row><table:table-cell><text:p>Cell A2</text:p></table:table-cell><table:table-cell><text:p>Cell B2</text:p></table:table-cell></table:table-row>
  </table:table>
 </office:text></office:body>
</office:document-content>`;

/** Package `content.xml` as a minimal ODT archive (matches the ODF layout). */
async function buildOdt(contentXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  // ODF requires the `mimetype` entry to be stored first and uncompressed.
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', {
    compression: 'STORE',
  });
  zip.file('content.xml', contentXml);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('extractTextFromOdtBytes (sample fixture)', () => {
  it('extracts the heading, paragraph, list items, and table cells', async () => {
    const [text, visionUsed] = await extractTextFromOdtBytes(
      await buildOdt(SAMPLE_CONTENT_XML),
      'sample.odt',
    );

    // Heading.
    expect(text).toContain('Sample ODT Test Document');
    // Paragraph.
    expect(text).toContain('This paragraph proves ODT text extraction works.');
    // List items.
    expect(text).toContain('First requirement');
    expect(text).toContain('Second requirement');
    // Table cells (every corner) + the table marker.
    expect(text).toContain('[Table]');
    expect(text).toContain('Cell A1');
    expect(text).toContain('Cell B1');
    expect(text).toContain('Cell A2');
    expect(text).toContain('Cell B2');
    // ODT has no Vision path.
    expect(visionUsed).toBe(false);
  });

  it('renders table rows as pipe-joined cells', async () => {
    const [text] = await extractTextFromOdtBytes(
      await buildOdt(SAMPLE_CONTENT_XML),
    );
    expect(text).toContain('Cell A1 | Cell B1');
    expect(text).toContain('Cell A2 | Cell B2');
  });

  it('preserves reading order: heading before list before table', async () => {
    const [text] = await extractTextFromOdtBytes(
      await buildOdt(SAMPLE_CONTENT_XML),
    );
    expect(text.indexOf('Sample ODT Test Document')).toBeLessThan(
      text.indexOf('First requirement'),
    );
    expect(text.indexOf('First requirement')).toBeLessThan(
      text.indexOf('Cell A1'),
    );
  });
});

describe('extractTextFromOdtBytes (whitespace + spans)', () => {
  it('joins spans within a paragraph and honours line breaks and tabs', async () => {
    const xml = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p><text:span>Hello</text:span><text:span> World</text:span></text:p><text:p>Line one<text:line-break/>Line two<text:tab/>tabbed</text:p></office:text></office:body></office:document-content>`;
    const [text] = await extractTextFromOdtBytes(await buildOdt(xml));
    expect(text).toContain('Hello World');
    expect(text).toContain('Line one\nLine two\ttabbed');
  });
});

describe('extractTextFromOdtBytes (errors)', () => {
  it('throws on empty/zero-byte input (not a zip)', async () => {
    await expect(
      extractTextFromOdtBytes(new Uint8Array(), 'empty.odt'),
    ).rejects.toThrow(/invalid or corrupt/i);
  });

  it('throws on a malformed non-zip payload named .odt', async () => {
    const notAZip = new TextEncoder().encode('this is definitely not a zip');
    await expect(extractTextFromOdtBytes(notAZip, 'fake.odt')).rejects.toThrow(
      /invalid or corrupt/i,
    );
  });

  it('throws when the archive has no content.xml', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
    zip.file('other.xml', '<x/>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await expect(
      extractTextFromOdtBytes(bytes, 'no-content.odt'),
    ).rejects.toThrow(/no readable content\.xml/i);
  });

  it('throws when content.xml has no <office:text> body', async () => {
    const xml = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body></office:body></office:document-content>`;
    await expect(
      extractTextFromOdtBytes(await buildOdt(xml), 'no-body.odt'),
    ).rejects.toThrow(/missing an <office:text> body/i);
  });
});
