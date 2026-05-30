import { describe, expect, it } from 'vitest';

import { buildDavPath, lockKeyFromParsed, parseDavPath } from './paths';

describe('parseDavPath', () => {
  it('parses the root pseudo-collection', () => {
    expect(parseDavPath('/dav/myorg/')).toMatchObject({
      orgSlug: 'myorg',
      namespace: 'documents',
      segments: [],
      isCollection: true,
    });
  });

  it('parses a documents namespace root', () => {
    expect(parseDavPath('/dav/myorg/documents/')).toMatchObject({
      orgSlug: 'myorg',
      namespace: 'documents',
      segments: [],
      isCollection: true,
    });
  });

  it('parses nested documents path', () => {
    expect(parseDavPath('/dav/myorg/documents/folder/file.docx')).toMatchObject(
      {
        orgSlug: 'myorg',
        namespace: 'documents',
        segments: ['folder', 'file.docx'],
        isCollection: false,
      },
    );
  });

  it('parses .trash namespace', () => {
    expect(parseDavPath('/dav/myorg/.trash/foo.txt')).toMatchObject({
      orgSlug: 'myorg',
      namespace: '.trash',
      segments: ['foo.txt'],
      isCollection: false,
    });
  });

  it('preserves trailing-slash collection signal', () => {
    expect(parseDavPath('/dav/myorg/documents/folder/')).toMatchObject({
      segments: ['folder'],
      isCollection: true,
    });
  });

  it('decodes percent-encoded segments', () => {
    expect(
      parseDavPath('/dav/myorg/documents/My%20Folder/r%C3%A9sum%C3%A9.pdf'),
    ).toMatchObject({
      segments: ['My Folder', 'résumé.pdf'],
    });
  });

  it('rejects path-traversal segments', () => {
    expect(parseDavPath('/dav/myorg/documents/..')).toBeNull();
    expect(parseDavPath('/dav/myorg/documents/.')).toBeNull();
  });

  it('rejects percent-encoded ".." segments', () => {
    // %2e%2e decodes to '..' which must be caught by the traversal check.
    expect(parseDavPath('/dav/myorg/documents/%2e%2e/x')).toBeNull();
  });

  it('treats double-encoded %25%32%65... as literal text, not ".."', () => {
    // %252e%252e decodes once to the literal string "%2e%2e" — a legal
    // (if ugly) filename. We must NOT recursively decode.
    const parsed = parseDavPath('/dav/myorg/documents/%252e%252e/x');
    expect(parsed).not.toBeNull();
    expect(parsed?.segments).toEqual(['%2e%2e', 'x']);
  });

  it('rejects unknown namespaces', () => {
    expect(parseDavPath('/dav/myorg/random/')).toBeNull();
  });

  it('rejects non-/dav/ prefixes', () => {
    expect(parseDavPath('/foo/myorg/documents/')).toBeNull();
  });

  it('rejects bad org slugs', () => {
    expect(parseDavPath('/dav//documents/')).toBeNull();
    expect(parseDavPath('/dav/has spaces/documents/')).toBeNull();
  });

  it('rejects NUL byte in segment', () => {
    expect(parseDavPath('/dav/myorg/documents/foo%00bar')).toBeNull();
  });

  it('rejects newline (LF) in segment', () => {
    expect(parseDavPath('/dav/myorg/documents/foo%0Abar')).toBeNull();
  });

  it('rejects carriage return (CR) in segment', () => {
    expect(parseDavPath('/dav/myorg/documents/foo%0Dbar')).toBeNull();
  });

  it('rejects DEL (0x7F) in segment', () => {
    expect(parseDavPath('/dav/myorg/documents/foo%7Fbar')).toBeNull();
  });

  it('rejects other C0 controls (e.g. TAB, ESC)', () => {
    expect(parseDavPath('/dav/myorg/documents/foo%09bar')).toBeNull();
    expect(parseDavPath('/dav/myorg/documents/foo%1Bbar')).toBeNull();
  });

  it('rejects empty segments from doubled slashes', () => {
    // '//x' produces an empty segment between the slashes; isValidSegment
    // rejects length-0 strings.
    expect(parseDavPath('/dav/myorg/documents//x')).toBeNull();
  });

  it('normalizes NFD and NFC unicode to the same segments', () => {
    // macOS Finder sends NFD: 'cafe' + U+0301 (combining acute).
    // Linux/Windows send NFC: 'caf' + U+00E9 (precomposed é).
    // Both must round-trip to the same logical filename.
    const nfd = parseDavPath('/dav/myorg/documents/cafe%CC%81.pdf');
    const nfc = parseDavPath('/dav/myorg/documents/caf%C3%A9.pdf');
    expect(nfd).not.toBeNull();
    expect(nfc).not.toBeNull();
    expect(nfd?.segments).toEqual(nfc?.segments);
    expect(nfc?.segments).toEqual(['café.pdf']);
  });

  it('returns null (not throws) on malformed percent-encoding', () => {
    // Before F.3 this raised URIError → 500. Now it returns null → 404.
    expect(() => parseDavPath('/dav/myorg/documents/%ZZ/x')).not.toThrow();
    expect(parseDavPath('/dav/myorg/documents/%ZZ/x')).toBeNull();
    expect(parseDavPath('/dav/myorg/documents/%E0%A4%A')).toBeNull();
    expect(parseDavPath('/dav/myorg/documents/%')).toBeNull();
  });

  it('returns null on malformed percent-encoding in org slug', () => {
    expect(() => parseDavPath('/dav/%ZZ/documents/')).not.toThrow();
    expect(parseDavPath('/dav/%ZZ/documents/')).toBeNull();
  });

  it('returns null on malformed percent-encoding in namespace', () => {
    expect(() => parseDavPath('/dav/myorg/%ZZ/x')).not.toThrow();
    expect(parseDavPath('/dav/myorg/%ZZ/x')).toBeNull();
  });

  it('accepts Windows reserved names as ordinary filenames', () => {
    // We do NOT block CON/PRN/AUX/NUL/COM*/LPT* — they're legitimate on
    // Linux/macOS, which is what the server filesystem runs.
    expect(parseDavPath('/dav/myorg/documents/CON')).toMatchObject({
      segments: ['CON'],
    });
    expect(parseDavPath('/dav/myorg/documents/PRN.txt')).toMatchObject({
      segments: ['PRN.txt'],
    });
  });
});

describe('buildDavPath', () => {
  it('round-trips a folder path', () => {
    const parsed = parseDavPath('/dav/myorg/documents/folder/sub/');
    if (!parsed) throw new Error('expected parsed to be non-null');
    expect(
      buildDavPath({
        orgSlug: parsed.orgSlug,
        namespace: parsed.namespace,
        segments: parsed.segments,
        isCollection: true,
      }),
    ).toBe('/dav/myorg/documents/folder/sub/');
  });

  it('encodes special characters', () => {
    expect(
      buildDavPath({
        orgSlug: 'myorg',
        namespace: 'documents',
        segments: ['My Folder', 'résumé.pdf'],
        isCollection: false,
      }),
    ).toBe('/dav/myorg/documents/My%20Folder/r%C3%A9sum%C3%A9.pdf');
  });

  it('NFC-normalizes NFD input on encode so the wire form is canonical', () => {
    // Feed NFD ("cafe" + combining acute) into buildDavPath; the output
    // must match the NFC-encoded form so round-tripping via parseDavPath
    // is stable across client encodings.
    const nfd = 'café.pdf';
    const nfc = 'café.pdf';
    expect(
      buildDavPath({
        orgSlug: 'myorg',
        namespace: 'documents',
        segments: [nfd],
        isCollection: false,
      }),
    ).toBe(
      buildDavPath({
        orgSlug: 'myorg',
        namespace: 'documents',
        segments: [nfc],
        isCollection: false,
      }),
    );
    expect(
      buildDavPath({
        orgSlug: 'myorg',
        namespace: 'documents',
        segments: [nfd],
        isCollection: false,
      }),
    ).toBe('/dav/myorg/documents/caf%C3%A9.pdf');
  });
});

describe('lockKeyFromParsed', () => {
  it('builds the org-scoped canonical key', () => {
    expect(
      lockKeyFromParsed({
        namespace: 'documents',
        segments: ['folder', 'file.docx'],
      }),
    ).toBe('/documents/folder/file.docx');
  });

  it('returns just the namespace for an empty path', () => {
    expect(lockKeyFromParsed({ namespace: 'documents', segments: [] })).toBe(
      '/documents',
    );
  });
});
