import { describe, it, expect } from 'vitest';

import { render, screen } from '@/test/utils/render';

import {
  EmailPreview,
  replaceCidReferences,
  rewriteExternalImageSrcs,
} from './email-preview';

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

describe('rewriteExternalImageSrcs', () => {
  const proxyBase = 'http://localhost:3000';

  it('rewrites external https image src to proxy URL', () => {
    const html = '<img src="https://claude.ai/images/logo.png">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    const encoded = encodeURIComponent(
      btoa('https://claude.ai/images/logo.png'),
    );
    expect(result).toBe(
      `<img src="http://localhost:3000/api/image-proxy?url=${encoded}">`,
    );
  });

  it('rewrites external http image src to proxy URL', () => {
    const html = '<img src="http://example.com/img.jpg">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toContain('/api/image-proxy?url=');
  });

  it('does not rewrite same-origin URLs', () => {
    const html = '<img src="http://localhost:3000/storage?id=abc">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toBe(html);
  });

  it('does not rewrite Convex storage URLs', () => {
    const html = '<img src="https://my-app.convex.cloud/storage?id=abc123">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toBe(html);
  });

  it('does not rewrite Convex site URLs', () => {
    const html = '<img src="https://my-app.convex.site/image.png">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toBe(html);
  });

  it('does not rewrite cid: references', () => {
    const html = '<img src="cid:foo@bar">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toBe(html);
  });

  it('does not rewrite data: URIs', () => {
    const html = '<img src="data:image/png;base64,abc123">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toBe(html);
  });

  it('handles single-quoted src attributes', () => {
    const html = "<img src='https://external.com/img.jpg'>";
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toContain('/api/image-proxy?url=');
  });

  it('does not double-proxy already-proxied URLs', () => {
    const html = '<img src="http://localhost:3000/api/image-proxy?url=abc">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toBe(html);
  });

  it('handles multiple images in one HTML string', () => {
    const html =
      '<img src="https://a.com/1.png"><p>text</p><img src="https://b.com/2.png">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    expect(result).toContain(
      `/api/image-proxy?url=${encodeURIComponent(btoa('https://a.com/1.png'))}`,
    );
    expect(result).toContain(
      `/api/image-proxy?url=${encodeURIComponent(btoa('https://b.com/2.png'))}`,
    );
  });

  it('decodes HTML entities in URLs before base64 encoding', () => {
    const html =
      '<img src="https://media.licdn.com/image?e=123&amp;v=beta&amp;t=abc">';
    const result = rewriteExternalImageSrcs(html, proxyBase);
    const encoded = encodeURIComponent(
      btoa('https://media.licdn.com/image?e=123&v=beta&t=abc'),
    );
    expect(result).toContain(`/api/image-proxy?url=${encoded}`);
  });

  it('returns html unchanged when proxyBase is invalid', () => {
    const html = '<img src="https://external.com/img.jpg">';
    const result = rewriteExternalImageSrcs(html, '');
    expect(result).toBe(html);
  });
});

describe('EmailPreview', () => {
  it('renders inline images when cidMap is provided', () => {
    const html = '<p>Hello</p><img src="cid:logo@company" alt="Logo">';
    const cidMap = { 'logo@company': 'https://storage.example.com/logo.png' };

    render(<EmailPreview html={html} cidMap={cidMap} />);

    const img = screen.getByAltText('Logo');
    const encoded = encodeURIComponent(
      btoa('https://storage.example.com/logo.png'),
    );
    expect(img).toHaveAttribute(
      'src',
      `http://localhost:3000/api/image-proxy?url=${encoded}`,
    );
  });

  it('renders without cidMap (backwards compatible)', () => {
    const html = '<p>Plain email</p>';
    render(<EmailPreview html={html} />);
    expect(screen.getByText('Plain email')).toBeInTheDocument();
  });
});
