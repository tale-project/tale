import { describe, it, expect } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { EmailPreview, replaceCidReferences } from './email-preview';

describe('replaceCidReferences', () => {
  it('replaces cid: references with URLs from the map', () => {
    const html = '<img src="cid:image001@example.com" alt="photo">';
    const cidMap = {
      'image001@example.com': 'https://storage.example.com/img1.png',
    };
    expect(replaceCidReferences(html, cidMap)).toBe(
      '<img src="https://storage.example.com/img1.png" alt="photo">',
    );
  });

  it('handles multiple cid references', () => {
    const html = '<img src="cid:img1@ex"><p>text</p><img src="cid:img2@ex">';
    const cidMap = {
      'img1@ex': 'https://cdn.example.com/1.png',
      'img2@ex': 'https://cdn.example.com/2.png',
    };
    const result = replaceCidReferences(html, cidMap);
    expect(result).toContain('src="https://cdn.example.com/1.png"');
    expect(result).toContain('src="https://cdn.example.com/2.png"');
  });

  it('leaves unmatched cid references unchanged', () => {
    const html = '<img src="cid:unknown@ex">';
    const cidMap = { 'known@ex': 'https://cdn.example.com/1.png' };
    expect(replaceCidReferences(html, cidMap)).toBe(html);
  });

  it('returns html unchanged when cidMap is empty', () => {
    const html = '<img src="cid:test@ex">';
    expect(replaceCidReferences(html, {})).toBe(html);
  });

  it('handles single-quoted src attributes', () => {
    const html = "<img src='cid:img@ex'>";
    const cidMap = { 'img@ex': 'https://cdn.example.com/1.png' };
    expect(replaceCidReferences(html, cidMap)).toContain(
      'src="https://cdn.example.com/1.png"',
    );
  });
});

describe('EmailPreview', () => {
  it('renders inline images when cidMap is provided', () => {
    const html = '<p>Hello</p><img src="cid:logo@company" alt="Logo">';
    const cidMap = { 'logo@company': 'https://storage.example.com/logo.png' };

    render(<EmailPreview html={html} cidMap={cidMap} />);

    const img = screen.getByAltText('Logo');
    expect(img).toHaveAttribute('src', 'https://storage.example.com/logo.png');
  });

  it('renders without cidMap (backwards compatible)', () => {
    const html = '<p>Plain email</p>';
    render(<EmailPreview html={html} />);
    expect(screen.getByText('Plain email')).toBeInTheDocument();
  });
});
