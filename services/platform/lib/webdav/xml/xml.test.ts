import { describe, expect, it } from 'vitest';

import { escapeXml, safeOwnerEmit } from './escape';
import {
  isOwnerExtractError,
  parseIfHeader,
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
        // etag is the COMPLETE validator (computeETag includes the quotes);
        // buildMultiStatus emits it verbatim so it matches the GET header.
        etag: '"abc123"',
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
    expect(li && 'scope' in li ? li.scope : null).toBe('exclusive');
    expect(li && 'ownerXml' in li ? li.ownerXml : null).toBe('me');
  });

  it('extracts shared scope', () => {
    const li = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:shared/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>`,
    );
    expect(li && 'scope' in li ? li.scope : null).toBe('shared');
  });

  it('preserves owner XML as-is for client passthrough', () => {
    const li = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><D:href>mailto:user@example.com</D:href></D:owner></D:lockinfo>`,
    );
    expect(li && 'ownerXml' in li ? li.ownerXml : '').toContain(
      'mailto:user@example.com',
    );
  });

  it('rejects ownerXml containing <!DOCTYPE>', () => {
    const result = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><!DOCTYPE foo></D:owner></D:lockinfo>`,
    );
    expect(result && isOwnerExtractError(result)).toBe(true);
    if (result && isOwnerExtractError(result)) {
      expect(result.kind).toBe('doctype');
    }
  });

  it('rejects ownerXml containing <!ENTITY>', () => {
    const result = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><!ENTITY foo "bar"></D:owner></D:lockinfo>`,
    );
    expect(result && isOwnerExtractError(result)).toBe(true);
    if (result && isOwnerExtractError(result)) {
      expect(result.kind).toBe('entity');
    }
  });

  it('rejects ownerXml containing CDATA section', () => {
    const result = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><![CDATA[evil]]></D:owner></D:lockinfo>`,
    );
    expect(result && isOwnerExtractError(result)).toBe(true);
    if (result && isOwnerExtractError(result)) {
      expect(result.kind).toBe('cdata');
    }
  });

  it('truncates ownerXml exceeding 4096 chars', () => {
    const big = 'a'.repeat(5000);
    const li = parseLockBody(
      `<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>${big}</D:owner></D:lockinfo>`,
    );
    expect(li && 'ownerXml' in li ? li.ownerXml.length : 0).toBeLessThanOrEqual(
      4096,
    );
    expect(li && 'ownerXml' in li ? li.ownerXml.endsWith('...') : false).toBe(
      true,
    );
  });
});

describe('parseTimeoutHeader', () => {
  it('parses Second-N', () => {
    expect(parseTimeoutHeader('Second-600')).toBe(600);
  });

  it('returns MAX_SAFE_INTEGER on Infinite (caller clamps)', () => {
    // RFC 4918 §10.7: "Infinite" is a valid token. Returning a sentinel
    // larger than MAX_TIMEOUT_SEC lets clampTimeout reduce it
    // uniformly with any other oversized client request.
    expect(parseTimeoutHeader('Infinite')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles Infinite case-insensitively', () => {
    expect(parseTimeoutHeader('infinite')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseTimeoutHeader('INFINITE')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('returns null on missing header', () => {
    expect(parseTimeoutHeader(null)).toBeNull();
  });

  it('picks the first parseable token from a list (Infinite wins)', () => {
    expect(parseTimeoutHeader('Infinite, Second-300')).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('picks Second-N when Infinite is not the first token', () => {
    expect(parseTimeoutHeader('Second-300, Infinite')).toBe(300);
  });
});

describe('parseIfHeaderTokens (back-compat)', () => {
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

describe('parseIfHeader (structured)', () => {
  it('parses No-tag-list form', () => {
    const clauses = parseIfHeader('(<opaquelocktoken:abc-123>)');
    expect(clauses).toEqual([
      {
        resource: null,
        conditions: [{ not: false, token: 'abc-123' }],
      },
    ]);
  });

  it('parses Tagged-list form', () => {
    const clauses = parseIfHeader(
      '<http://example.com/foo> (<opaquelocktoken:abc-123>)',
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0].resource).toBe('http://example.com/foo');
    expect(clauses[0].conditions).toEqual([{ not: false, token: 'abc-123' }]);
  });

  it('parses Not operator', () => {
    const clauses = parseIfHeader('(Not <opaquelocktoken:abc-123>)');
    expect(clauses[0].conditions).toEqual([{ not: true, token: 'abc-123' }]);
  });

  it('parses bracketed entity-tag conditions', () => {
    const clauses = parseIfHeader('(["e-tag-1"])');
    expect(clauses[0].conditions).toEqual([{ not: false, etag: 'e-tag-1' }]);
  });

  it('parses weak ETag with W/ prefix', () => {
    const clauses = parseIfHeader('([W/"weak-tag"])');
    expect(clauses[0].conditions).toEqual([{ not: false, etag: 'weak-tag' }]);
  });

  it('AND inside parens — multiple conditions in one clause', () => {
    const clauses = parseIfHeader('(<opaquelocktoken:abc> ["e-tag-1"])');
    expect(clauses).toHaveLength(1);
    expect(clauses[0].conditions).toEqual([
      { not: false, token: 'abc' },
      { not: false, etag: 'e-tag-1' },
    ]);
  });

  it('OR across parens — multiple clauses', () => {
    const clauses = parseIfHeader(
      '(<opaquelocktoken:abc>) (<opaquelocktoken:def>)',
    );
    expect(clauses).toHaveLength(2);
    expect(clauses[0].conditions[0].token).toBe('abc');
    expect(clauses[1].conditions[0].token).toBe('def');
  });

  it('Tagged-list carries resource across following Lists', () => {
    const clauses = parseIfHeader(
      '<http://ex.com/a> (<opaquelocktoken:t1>) (<opaquelocktoken:t2>)',
    );
    expect(clauses).toHaveLength(2);
    expect(clauses[0].resource).toBe('http://ex.com/a');
    expect(clauses[1].resource).toBe('http://ex.com/a');
  });

  it('returns empty array on null / empty header', () => {
    expect(parseIfHeader(null)).toEqual([]);
    expect(parseIfHeader('')).toEqual([]);
  });

  it('handles mixed Not + token + etag combination', () => {
    const clauses = parseIfHeader('(<opaquelocktoken:abc> Not ["bad-etag"])');
    expect(clauses[0].conditions).toEqual([
      { not: false, token: 'abc' },
      { not: true, etag: 'bad-etag' },
    ]);
  });
});

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('strips XML-1.0-illegal C0 control chars but keeps tab/LF/CR', () => {
    const input = 'rep\u0000o\u0008rt\u001fx';
    expect(escapeXml(input)).toBe('reportx');
    // Legal whitespace controls survive untouched.
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('strips the U+FFFE/U+FFFF non-characters', () => {
    expect(escapeXml('a\uFFFEb\uFFFFc')).toBe('abc');
  });

  it('yields a well-formed element even when the source had a control byte', () => {
    // A doc title with a NUL must not corrupt the surrounding markup.
    const body = `<D:displayname>${escapeXml('foo\u0000bar')}</D:displayname>`;
    expect(body).toBe('<D:displayname>foobar</D:displayname>');
  });
});

describe('safeOwnerEmit', () => {
  it('wraps non-empty owner in CDATA', () => {
    expect(safeOwnerEmit('me')).toBe('<D:owner><![CDATA[me]]></D:owner>');
  });

  it('strips XML-illegal control chars before CDATA-wrapping', () => {
    expect(safeOwnerEmit('o\u0001wner')).toBe(
      '<D:owner><![CDATA[owner]]></D:owner>',
    );
  });

  it('returns empty string for empty input', () => {
    expect(safeOwnerEmit('')).toBe('');
    expect(safeOwnerEmit('   ')).toBe('');
  });

  it('neutralizes embedded ]]> sequences', () => {
    const out = safeOwnerEmit('foo]]>bar');
    expect(out).not.toContain('foo]]>bar');
    // Standard CDATA escape splits via "]]]]><![CDATA[>".
    expect(out).toContain(']]]]><![CDATA[>');
  });

  it('preserves structured XML inside CDATA', () => {
    const owner = '<D:href>mailto:me@example.com</D:href>';
    const out = safeOwnerEmit(owner);
    expect(out).toContain(owner);
    expect(out.startsWith('<D:owner><![CDATA[')).toBe(true);
    expect(out.endsWith(']]></D:owner>')).toBe(true);
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

  it('emits owner via CDATA wrapper', () => {
    const body = buildLockResponse({
      scope: 'exclusive',
      ownerXml: 'someone',
      depth: '0',
      timeoutSeconds: 600,
      lockToken: 'abc-123',
      href: '/dav/myorg/documents/file.docx',
    });
    expect(body).toContain('<D:owner><![CDATA[someone]]></D:owner>');
  });
});
