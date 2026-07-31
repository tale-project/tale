import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { ALL_SUPPORTED_EXTENSIONS, extractText, isSupported } from './router';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('isSupported', () => {
  it('supports office formats', () => {
    expect(isSupported('document.pdf')).toBe(true);
    expect(isSupported('document.docx')).toBe(true);
    expect(isSupported('document.odt')).toBe(true);
    expect(isSupported('slides.pptx')).toBe(true);
    expect(isSupported('data.xlsx')).toBe(true);
  });

  it('supports images', () => {
    for (const f of [
      'photo.png',
      'photo.jpg',
      'photo.jpeg',
      'photo.gif',
      'photo.webp',
    ]) {
      expect(isSupported(f)).toBe(true);
    }
  });

  it('supports text formats', () => {
    expect(isSupported('readme.md')).toBe(true);
    expect(isSupported('notes.txt')).toBe(true);
    expect(isSupported('data.csv')).toBe(true);
  });

  it('rejects unsupported formats', () => {
    expect(isSupported('archive.zip')).toBe(false);
    expect(isSupported('video.mp4')).toBe(false);
    expect(isSupported('binary.exe')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSupported('Document.PDF')).toBe(true);
    expect(isSupported('Image.PNG')).toBe(true);
  });
});

describe('extractText', () => {
  it('extracts a text file', async () => {
    const content =
      'Hello, this is a test document with enough content to be meaningful.';
    const [text, visionUsed] = await extractText(enc(content), 'test.txt');
    expect(text).toBe(content);
    expect(visionUsed).toBe(false);
  });

  it('extracts a markdown file', async () => {
    const [text, visionUsed] = await extractText(
      enc('# Title\n\nSome markdown content'),
      'readme.md',
    );
    expect(text).toContain('# Title');
    expect(visionUsed).toBe(false);
  });

  it('routes an .odt file to the ODT extractor', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
    zip.file(
      'content.xml',
      `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h>Routed Heading</text:h><text:p>Routed body content.</text:p></office:text></office:body></office:document-content>`,
    );
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const [text, visionUsed] = await extractText(bytes, 'routed.odt');
    expect(text).toContain('Routed Heading');
    expect(text).toContain('Routed body content.');
    expect(visionUsed).toBe(false);
  });

  it('throws on unsupported types', async () => {
    await expect(extractText(enc('data'), 'archive.zip')).rejects.toThrow(
      'Unsupported file type',
    );
  });
});

describe('ALL_SUPPORTED_EXTENSIONS', () => {
  it('contains the expected core extensions', () => {
    for (const ext of [
      '.pdf',
      '.docx',
      '.odt',
      '.pptx',
      '.xlsx',
      '.png',
      '.txt',
      '.md',
      '.csv',
    ]) {
      expect(ALL_SUPPORTED_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});
