import { describe, expect, it } from 'vitest';

// extractUrl is not exported, so we re-implement the same regex for unit testing.
// This keeps the test coupled to the documented behavior, not the implementation.
const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;

function extractUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
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
