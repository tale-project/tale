import { describe, expect, it } from 'vitest';

import {
  parseIfHeaderTokens,
  parseLockBody,
  parseTimeoutHeader,
} from './lock-request';
import { buildLockResponse } from './lock-response';
import { parsePropfindBody } from './propfind-request';
import { buildMultiStatus } from './propfind-response';

describe('parsePropfindBody', () => {
  it('treats empty body as allprop (Finder default)', () => {
    expect(parsePropfindBody('')).toEqual({ kind: 'allprop' });
  });

  it('parses <allprop/>', () => {
    expect(
      parsePropfindBody(
        '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>',
      ),
    ).toEqual({ kind: 'allprop' });
  });

  it('parses <propname/>', () => {
    expect(
      parsePropfindBody(
        '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>',
      ),
    ).toEqual({ kind: 'propname' });
  });

  it('parses explicit <prop> list', () => {
    const result = parsePropfindBody(
      `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/><D:getcontentlength/></D:prop></D:propfind>`,
    );
    expect(result.kind).toBe('prop');
    if (result.kind === 'prop') {
      expect(result.props).toEqual(
        expect.arrayContaining(['displayname', 'getcontentlength']),
      );
    }
  });
});

describe('buildMultiStatus', () => {
  it('emits a 207 body for a single collection', () => {
    const xml = buildMultiStatus([
      {
        href: '/dav/myorg/documents/',
        isCollection: true,
        displayName: 'documents',
        lastModified: new Date('2026-01-01T00:00:00Z'),
        creationDate: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    expect(xml).toContain('<D:multistatus xmlns:D="DAV:">');
    expect(xml).toContain('<D:collection/>');
    expect(xml).toContain('<D:href>/dav/myorg/documents/</D:href>');
    expect(xml).toContain('<D:status>HTTP/1.1 200 OK</D:status>');
  });

  it('omits getcontentlength on collections', () => {
    const xml = buildMultiStatus([
      {
        href: '/dav/myorg/documents/folder/',
        isCollection: true,
        displayName: 'folder',
        lastModified: new Date(),
        creationDate: new Date(),
        contentLength: 0, // ignored — collections never emit this
      },
    ]);
    expect(xml).not.toContain('getcontentlength');
  });

  it('emits getcontentlength + getcontenttype for documents', () => {
    const xml = buildMultiStatus([
      {
        href: '/dav/myorg/documents/file.txt',
        isCollection: false,
        displayName: 'file.txt',
        lastModified: new Date(),
        creationDate: new Date(),
        contentLength: 1234,
        contentType: 'text/plain',
        etag: 'abc123',
      },
    ]);
    expect(xml).toContain('<D:getcontentlength>1234</D:getcontentlength>');
    expect(xml).toContain('<D:getcontenttype>text/plain</D:getcontenttype>');
    expect(xml).toContain('<D:getetag>"abc123"</D:getetag>');
  });

  it('escapes special characters in displayname / href', () => {
    const xml = buildMultiStatus([
      {
        href: '/dav/myorg/documents/<>&"',
        isCollection: false,
        displayName: 'A&B<C>',
        lastModified: new Date(),
        creationDate: new Date(),
      },
    ]);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
  });
});

describe('parseLockBody', () => {
  it('returns null on empty body (refresh path)', () => {
    expect(parseLockBody('')).toBeNull();
  });

  it('extracts exclusive scope by default', () => {
    const li = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>me</D:owner></D:lockinfo>`,
    );
    expect(li?.scope).toBe('exclusive');
    expect(li?.ownerXml).toBe('me');
  });

  it('extracts shared scope', () => {
    const li = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>`,
    );
    expect(li?.scope).toBe('shared');
  });

  it('preserves owner XML as-is for client passthrough', () => {
    const li = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><D:href>mailto:user@example.com</D:href></D:owner></D:lockinfo>`,
    );
    expect(li?.ownerXml).toContain('mailto:user@example.com');
  });
});

describe('parseTimeoutHeader', () => {
  it('parses Second-N', () => {
    expect(parseTimeoutHeader('Second-600')).toBe(600);
  });

  it('returns null on Infinite (we cap externally)', () => {
    expect(parseTimeoutHeader('Infinite')).toBeNull();
  });

  it('returns null on missing header', () => {
    expect(parseTimeoutHeader(null)).toBeNull();
  });

  it('picks the first parseable token from a list', () => {
    expect(parseTimeoutHeader('Infinite, Second-300')).toBe(300);
  });
});

describe('parseIfHeaderTokens', () => {
  it('extracts tokens from the standard form', () => {
    expect(
      parseIfHeaderTokens(
        '(<opaquelocktoken:11111111-2222-3333-4444-555555555555>)',
      ),
    ).toEqual(['11111111-2222-3333-4444-555555555555']);
  });

  it('extracts multiple tokens', () => {
    expect(
      parseIfHeaderTokens('(<opaquelocktoken:abc>) (<opaquelocktoken:def>)'),
    ).toEqual(['abc', 'def']);
  });

  it('returns empty on missing header', () => {
    expect(parseIfHeaderTokens(null)).toEqual([]);
  });
});

describe('buildLockResponse', () => {
  it('emits the activelock structure', () => {
    const body = buildLockResponse({
      scope: 'exclusive',
      ownerXml: '<D:href>mailto:me</D:href>',
      depth: '0',
      timeoutSeconds: 600,
      lockToken: 'abc-123',
      href: '/dav/myorg/documents/file.docx',
    });
    expect(body).toContain('<D:activelock>');
    expect(body).toContain('<D:exclusive/>');
    expect(body).toContain('<D:depth>0</D:depth>');
    expect(body).toContain('<D:timeout>Second-600</D:timeout>');
    expect(body).toContain('<D:href>opaquelocktoken:abc-123</D:href>');
    expect(body).toContain('mailto:me');
  });
});
