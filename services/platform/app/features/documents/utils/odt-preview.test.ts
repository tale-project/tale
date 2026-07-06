// @vitest-environment jsdom
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { odtBytesToHtml, odtContentXmlToHtml } from './odt-preview';

// Matches the `content.xml` shape of the backend extractor's fixture
// (`convex/lib/knowledge/extraction/odt.test.ts`): heading + paragraph +
// a 2-item list + a 2x2 table.
const SAMPLE_CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2">
 <office:body><office:text>
  <text:h text:outline-level="1">Sample ODT Test Document</text:h>
  <text:p>This paragraph proves ODT preview works.</text:p>
  <text:list><text:list-item><text:p>First requirement</text:p></text:list-item><text:list-item><text:p>Second requirement</text:p></text:list-item></text:list>
  <table:table table:name="T1">
   <table:table-row><table:table-cell><text:p>Cell A1</text:p></table:table-cell><table:table-cell><text:p>Cell B1</text:p></table:table-cell></table:table-row>
   <table:table-row><table:table-cell><text:p>Cell A2</text:p></table:table-cell><table:table-cell><text:p>Cell B2</text:p></table:table-cell></table:table-row>
  </table:table>
 </office:text></office:body>
</office:document-content>`;

/** Package `content.xml` as a minimal ODT archive (matches the ODF layout). */
async function buildOdt(contentXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  // ODF requires the `mimetype` entry to be stored first and uncompressed.
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', {
    compression: 'STORE',
  });
  zip.file('content.xml', contentXml);
  return zip.generateAsync({ type: 'arraybuffer' });
}

/** Parse produced HTML for structural assertions. */
function toDom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('odtBytesToHtml (sample fixture)', () => {
  it('renders heading, paragraph, list items, and table cells as HTML', async () => {
    const html = await odtBytesToHtml(await buildOdt(SAMPLE_CONTENT_XML));
    const dom = toDom(html);

    expect(dom.querySelector('h1')?.textContent).toBe(
      'Sample ODT Test Document',
    );
    expect(dom.querySelector('p')?.textContent).toBe(
      'This paragraph proves ODT preview works.',
    );
    const items = Array.from(dom.querySelectorAll('ul li')).map((li) =>
      li.textContent?.trim(),
    );
    expect(items).toEqual(['First requirement', 'Second requirement']);
    const cells = Array.from(dom.querySelectorAll('table tr td')).map((td) =>
      td.textContent?.trim(),
    );
    expect(cells).toEqual(['Cell A1', 'Cell B1', 'Cell A2', 'Cell B2']);
  });

  it('preserves reading order: heading before list before table', async () => {
    const html = await odtBytesToHtml(await buildOdt(SAMPLE_CONTENT_XML));
    expect(html.indexOf('Sample ODT Test Document')).toBeLessThan(
      html.indexOf('First requirement'),
    );
    expect(html.indexOf('First requirement')).toBeLessThan(
      html.indexOf('Cell A1'),
    );
  });
});

describe('odtContentXmlToHtml (inline content and whitespace)', () => {
  const wrap = (body: string) =>
    `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${body}</office:text></office:body></office:document-content>`;

  it('joins spans within a paragraph and honours line breaks', () => {
    const html = odtContentXmlToHtml(
      wrap(
        '<text:p><text:span>Hello</text:span><text:span> World</text:span></text:p><text:p>Line one<text:line-break/>Line two</text:p>',
      ),
    );
    const dom = toDom(html);
    const paragraphs = dom.querySelectorAll('p');
    expect(paragraphs[0].textContent).toBe('Hello World');
    expect(paragraphs[1].querySelector('br')).not.toBeNull();
    expect(paragraphs[1].textContent).toBe('Line oneLine two');
  });

  it('clamps heading outline levels to h1–h4', () => {
    const html = odtContentXmlToHtml(
      wrap(
        '<text:h text:outline-level="2">Second</text:h><text:h text:outline-level="9">Deep</text:h>',
      ),
    );
    const dom = toDom(html);
    expect(dom.querySelector('h2')?.textContent).toBe('Second');
    expect(dom.querySelector('h4')?.textContent).toBe('Deep');
  });

  it('drops empty spacing paragraphs and escapes markup-looking text', () => {
    const html = odtContentXmlToHtml(
      wrap(
        '<text:p></text:p><text:p>&lt;script&gt;alert(1)&lt;/script&gt; safe</text:p>',
      ),
    );
    const dom = toDom(html);
    expect(dom.querySelectorAll('p')).toHaveLength(1);
    expect(dom.querySelector('script')).toBeNull();
    expect(dom.querySelector('p')?.textContent).toBe(
      '<script>alert(1)</script> safe',
    );
  });
});

describe('odtBytesToHtml (errors)', () => {
  it('rejects a payload that is not a zip archive', async () => {
    const notAZip = new TextEncoder().encode('this is definitely not a zip');
    await expect(odtBytesToHtml(notAZip.buffer)).rejects.toThrow(
      /invalid or corrupt/i,
    );
  });

  it('rejects an archive without content.xml', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
    zip.file('other.xml', '<x/>');
    const bytes = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(odtBytesToHtml(bytes)).rejects.toThrow(
      /no readable content\.xml/i,
    );
  });

  it('rejects malformed content.xml', async () => {
    const bytes = await buildOdt('<office:document-content');
    await expect(odtBytesToHtml(bytes)).rejects.toThrow(/could not parse/i);
  });

  it('rejects content.xml without an <office:text> body', async () => {
    const bytes = await buildOdt(
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body></office:body></office:document-content>',
    );
    await expect(odtBytesToHtml(bytes)).rejects.toThrow(
      /missing an <office:text> body/i,
    );
  });
});
