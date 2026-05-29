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
