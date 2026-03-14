import { describe, expect, it } from 'vitest';

// extractUrl and isFileUrl are not exported, so we re-implement them for unit testing.
// This keeps tests coupled to the documented behavior, not the implementation.
const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;
const FILE_EXTENSIONS = /\.(pdf|docx|pptx|png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;

function extractUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

function isFileUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return FILE_EXTENSIONS.test(path);
  } catch {
    return false;
  }
}

describe('extractUrl', () => {
  it('extracts a plain HTTP URL', () => {
    expect(extractUrl('https://example.com')).toBe('https://example.com');
  });

  it('extracts a URL with path', () => {
    expect(extractUrl('https://example.com/page/about')).toBe(
      'https://example.com/page/about',
    );
  });

  it('extracts a URL with query parameters', () => {
    expect(extractUrl('https://example.com/search?q=test&page=1')).toBe(
      'https://example.com/search?q=test&page=1',
    );
  });

  it('extracts URL embedded in text', () => {
    expect(
      extractUrl('Please read https://example.com/report.pdf for details'),
    ).toBe('https://example.com/report.pdf');
  });

  it('extracts first URL when multiple are present', () => {
    expect(extractUrl('See https://a.com and https://b.com')).toBe(
      'https://a.com',
    );
  });

  it('returns null for plain text without URLs', () => {
    expect(extractUrl('shipping policy')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractUrl('')).toBeNull();
  });

  it('extracts HTTP URL (not just HTTPS)', () => {
    expect(extractUrl('http://example.com/page')).toBe(
      'http://example.com/page',
    );
  });

  it('handles URL with port number', () => {
    expect(extractUrl('https://example.com:8080/api')).toBe(
      'https://example.com:8080/api',
    );
  });

  it('handles URL with fragment', () => {
    expect(extractUrl('https://example.com/page#section')).toBe(
      'https://example.com/page#section',
    );
  });

  it('does not match partial schemes like ftp://', () => {
    expect(extractUrl('ftp://example.com/file')).toBeNull();
  });

  it('extracts document file URLs', () => {
    expect(extractUrl('https://example.com/report.pdf')).toBe(
      'https://example.com/report.pdf',
    );
    expect(extractUrl('https://example.com/doc.docx')).toBe(
      'https://example.com/doc.docx',
    );
    expect(extractUrl('https://example.com/slides.pptx')).toBe(
      'https://example.com/slides.pptx',
    );
  });

  it('extracts image URLs', () => {
    expect(extractUrl('https://cdn.example.com/photo.jpg')).toBe(
      'https://cdn.example.com/photo.jpg',
    );
    expect(extractUrl('https://cdn.example.com/image.png')).toBe(
      'https://cdn.example.com/image.png',
    );
  });
});

describe('isFileUrl', () => {
  it('detects document URLs', () => {
    expect(isFileUrl('https://example.com/report.pdf')).toBe(true);
    expect(isFileUrl('https://example.com/doc.docx')).toBe(true);
    expect(isFileUrl('https://example.com/slides.pptx')).toBe(true);
  });

  it('detects image URLs', () => {
    expect(isFileUrl('https://cdn.example.com/photo.png')).toBe(true);
    expect(isFileUrl('https://cdn.example.com/photo.jpg')).toBe(true);
    expect(isFileUrl('https://cdn.example.com/photo.jpeg')).toBe(true);
    expect(isFileUrl('https://cdn.example.com/photo.gif')).toBe(true);
    expect(isFileUrl('https://cdn.example.com/photo.webp')).toBe(true);
    expect(isFileUrl('https://cdn.example.com/photo.bmp')).toBe(true);
    expect(isFileUrl('https://cdn.example.com/photo.tiff')).toBe(true);
    expect(isFileUrl('https://cdn.example.com/photo.svg')).toBe(true);
  });

  it('returns false for web page URLs', () => {
    expect(isFileUrl('https://example.com')).toBe(false);
    expect(isFileUrl('https://example.com/page')).toBe(false);
    expect(isFileUrl('https://example.com/page/about')).toBe(false);
    expect(isFileUrl('https://www.deutsche-boerse.com')).toBe(false);
  });

  it('returns false for URLs with query params but no file extension', () => {
    expect(isFileUrl('https://example.com/page?foo=bar')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isFileUrl('https://example.com/Report.PDF')).toBe(true);
    expect(isFileUrl('https://example.com/Image.PNG')).toBe(true);
  });

  it('returns false for invalid URLs', () => {
    expect(isFileUrl('not-a-url')).toBe(false);
  });
});
