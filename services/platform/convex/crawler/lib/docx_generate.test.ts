import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  escapeXml,
  generateDocxBytes,
  htmlToDocxBytes,
  markdownToDocxBytes,
} from './docx_generate';

/** Read `word/document.xml` out of a generated DOCX for assertions. */
async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('word/document.xml');
  expect(file).not.toBeNull();
  return file ? file.async('string') : '';
}

describe('escapeXml', () => {
  it('escapes XML metacharacters', () => {
    expect(escapeXml('<a> & "b" \'c\'')).toBe(
      '&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;',
    );
  });
});

describe('generateDocxBytes', () => {
  it('produces a valid OOXML package with required parts', async () => {
    const bytes = await generateDocxBytes({ title: 'Doc', sections: [] });
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('_rels/.rels')).not.toBeNull();
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(zip.file('word/styles.xml')).not.toBeNull();
  });

  it('renders the title with the Title style, centered', async () => {
    const xml = await documentXml(
      await generateDocxBytes({ title: 'Hello', sections: [] }),
    );
    expect(xml).toContain('w:val="Title"');
    expect(xml).toContain('w:val="center"');
    expect(xml).toContain('Hello');
  });

  it('renders headings, paragraphs, lists, quotes and code', async () => {
    const xml = await documentXml(
      await generateDocxBytes({
        title: 'T',
        sections: [
          { type: 'heading', level: 2, text: 'Section' },
          { type: 'paragraph', text: 'Body text' },
          { type: 'bullets', items: ['a', 'b'] },
          { type: 'numbered', items: ['1', '2'] },
          { type: 'quote', text: 'Quoted' },
          { type: 'code', text: 'code()' },
        ],
      }),
    );
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain('Body text');
    expect(xml).toContain('w:val="ListBullet"');
    expect(xml).toContain('w:val="ListNumber"');
    expect(xml).toContain('w:val="Quote"');
    expect(xml).toContain('code()');
  });

  it('renders a table with header row and data rows', async () => {
    const xml = await documentXml(
      await generateDocxBytes({
        title: 'T',
        sections: [
          {
            type: 'table',
            headers: ['H1', 'H2'],
            rows: [
              ['a', 'b'],
              ['c', 'd'],
            ],
          },
        ],
      }),
    );
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('H1');
    expect(xml).toContain('a');
    expect(xml).toContain('d');
  });

  it('pads short table rows to the header width', async () => {
    const xml = await documentXml(
      await generateDocxBytes({
        title: 'T',
        sections: [{ type: 'table', headers: ['A', 'B', 'C'], rows: [['x']] }],
      }),
    );
    // Three columns declared in the grid.
    expect((xml.match(/<w:gridCol\/?>/g) ?? []).length).toBe(3);
  });

  it('renders the subtitle when present', async () => {
    const xml = await documentXml(
      await generateDocxBytes({
        title: 'T',
        subtitle: 'My subtitle',
        sections: [],
      }),
    );
    expect(xml).toContain('My subtitle');
  });

  it('escapes special characters in section text', async () => {
    const xml = await documentXml(
      await generateDocxBytes({
        title: 'T',
        sections: [{ type: 'paragraph', text: 'a < b & c' }],
      }),
    );
    expect(xml).toContain('a &lt; b &amp; c');
  });
});

describe('htmlToDocxBytes', () => {
  it('converts HTML structure into a DOCX', async () => {
    const xml = await documentXml(
      await htmlToDocxBytes('<h1>Title</h1><p>Para</p><ul><li>item</li></ul>'),
    );
    expect(xml).toContain('Title');
    expect(xml).toContain('Para');
    expect(xml).toContain('item');
  });
});

describe('markdownToDocxBytes', () => {
  it('converts markdown (incl. tables) into a DOCX', async () => {
    const xml = await documentXml(
      await markdownToDocxBytes('# Heading\n\n| A | B |\n|---|---|\n| 1 | 2 |'),
    );
    expect(xml).toContain('Heading');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('A');
  });
});
