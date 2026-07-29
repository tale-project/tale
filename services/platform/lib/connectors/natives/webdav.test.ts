import { describe, expect, it } from 'vitest';

import type { NativeConnectorContext } from '../dispatcher';
import {
  MAX_WRITE_BYTES,
  webdavNatives,
  WebdavStoreError,
  type WebdavEntry,
  type WebdavFileBytes,
  type WebdavStore,
  type WebdavStoreErrorCode,
} from './webdav';

/**
 * These actions act on an organization's own files, so the tests are about the
 * two things that keep that safe — the tenant comes from the invocation and
 * never from the input, and a path can only ever address a descendant of that
 * tenant's root — plus the refusals the document store owns (a legal hold)
 * being surfaced rather than worked around.
 *
 * Nothing here touches Convex: the store is a double that records what it was
 * asked for, which is exactly what the assertions are about.
 */

const ORG = 'org_caller';
const OTHER_ORG = 'org_other';

interface StoreCall {
  readonly method: 'list' | 'read' | 'write' | 'remove';
  readonly organizationId: string;
  readonly segments: readonly string[];
}

interface StubOptions {
  entries?: readonly WebdavEntry[];
  file?: WebdavFileBytes;
  removed?: boolean;
  fail?: WebdavStoreErrorCode;
}

function stubStore(options: StubOptions = {}): WebdavStore & {
  calls: StoreCall[];
} {
  const calls: StoreCall[] = [];
  const boom = (): never => {
    if (!options.fail) throw new Error('no failure configured');
    throw new WebdavStoreError(options.fail, `store refused: ${options.fail}`);
  };
  return {
    calls,
    async list({ organizationId, segments }) {
      calls.push({ method: 'list', organizationId, segments });
      if (options.fail) boom();
      return (
        options.entries ?? [
          { name: 'archive', isDir: true, size: 0 },
          { name: 'notes.md', isDir: false, size: 128 },
        ]
      );
    },
    async read({ organizationId, segments }) {
      calls.push({ method: 'read', organizationId, segments });
      if (options.fail) boom();
      return (
        options.file ?? {
          bytes: new TextEncoder().encode('# Q3\n'),
          contentType: 'text/markdown',
        }
      );
    },
    async write({ organizationId, segments }) {
      calls.push({ method: 'write', organizationId, segments });
      if (options.fail) boom();
    },
    async remove({ organizationId, segments }) {
      calls.push({ method: 'remove', organizationId, segments });
      if (options.fail) boom();
      return options.removed ?? true;
    },
  };
}

/** A native context whose only organization is the caller's. */
function context(): NativeConnectorContext {
  return {
    secrets: { get: () => '' },
    idempotencyKey: 'key_1',
    config: {},
    organizationId: ORG,
    credentialId: 'cred_1',
    authMethod: 'basic',
    http: {
      get: () => Promise.reject(new Error('no HTTP in a webdav native')),
      post: () => Promise.reject(new Error('no HTTP in a webdav native')),
      put: () => Promise.reject(new Error('no HTTP in a webdav native')),
      patch: () => Promise.reject(new Error('no HTTP in a webdav native')),
      delete: () => Promise.reject(new Error('no HTTP in a webdav native')),
    },
    base64Encode: (value) => Buffer.from(value, 'utf8').toString('base64'),
    base64Decode: (value) => Buffer.from(value, 'base64').toString('utf8'),
  };
}

describe('declared output shapes', () => {
  it('list returns the entries the connector declares', async () => {
    const store = stubStore();
    const natives = webdavNatives(store);
    const output = await natives['webdav.list'](
      { path: '/reports' },
      context(),
    );

    expect(output).toEqual({
      entries: [
        { path: '/reports/archive', name: 'archive', isDir: true, size: 0 },
        {
          path: '/reports/notes.md',
          name: 'notes.md',
          isDir: false,
          size: 128,
        },
      ],
    });
  });

  it('list names entries of the root without doubling its slash', async () => {
    const natives = webdavNatives(stubStore());
    const output = await natives['webdav.list']({ path: '/' }, context());

    expect(output).toEqual({
      entries: [
        { path: '/archive', name: 'archive', isDir: true, size: 0 },
        { path: '/notes.md', name: 'notes.md', isDir: false, size: 128 },
      ],
    });
  });

  it('read returns the path, content type, and contents', async () => {
    const natives = webdavNatives(stubStore());
    const output = await natives['webdav.read'](
      { path: '/reports/q3.md' },
      context(),
    );

    expect(output).toEqual({
      path: '/reports/q3.md',
      contentType: 'text/markdown',
      content: '# Q3\n',
    });
  });

  it('write reports the path and the bytes actually written', async () => {
    const natives = webdavNatives(stubStore());
    // Four UTF-8 bytes from two characters — a string length would be wrong.
    const output = await natives['webdav.write'](
      { path: '/reports/summary.md', content: 'né' },
      context(),
    );

    expect(output).toEqual({ path: '/reports/summary.md', bytesWritten: 3 });
  });

  it('delete reports the path and whether anything was there', async () => {
    const present = webdavNatives(stubStore({ removed: true }));
    await expect(
      present['webdav.delete']({ path: '/reports/old.md' }, context()),
    ).resolves.toEqual({ path: '/reports/old.md', deleted: true });

    const absent = webdavNatives(stubStore({ removed: false }));
    await expect(
      absent['webdav.delete']({ path: '/reports/gone.md' }, context()),
    ).resolves.toEqual({ path: '/reports/gone.md', deleted: false });
  });
});

describe('the organization is the invocation’s, never the input’s', () => {
  it('asks the store about the calling organization only', async () => {
    const store = stubStore();
    const natives = webdavNatives(store);
    await natives['webdav.list'](
      { path: `/${OTHER_ORG}/documents` },
      context(),
    );

    expect(store.calls).toEqual([
      {
        method: 'list',
        organizationId: ORG,
        segments: [OTHER_ORG, 'documents'],
      },
    ]);
  });

  it('ignores an organization the input tries to name', async () => {
    const store = stubStore();
    const natives = webdavNatives(store);
    await natives['webdav.read'](
      { path: '/reports/q3.md', organizationId: OTHER_ORG },
      context(),
    );

    expect(store.calls[0]?.organizationId).toBe(ORG);
  });
});

describe('path safety', () => {
  const hostile: Array<[string, string]> = [
    ['a parent traversal', '/reports/../../org-other/secret.md'],
    ['an authority-style absolute path', '//org-other/documents/secret.md'],
    ['a NUL character', '/reports/q3\0.md'],
    ['a URL to another tenant', 'https://tale.example.com/dav/org-other/x'],
  ];

  it.each(hostile)('refuses %s before reaching the store', async (_l, path) => {
    for (const [id, input] of [
      ['webdav.list', { path }],
      ['webdav.read', { path }],
      ['webdav.write', { path, content: 'x' }],
      ['webdav.delete', { path }],
    ] as const) {
      const store = stubStore();
      const natives = webdavNatives(store);
      await expect(natives[id](input, context())).rejects.toMatchObject({
        code: 'INPUT_INVALID',
      });
      expect(store.calls).toEqual([]);
    }
  });

  it('refuses to write to, or delete, the organization root', async () => {
    const store = stubStore();
    const natives = webdavNatives(store);

    await expect(
      natives['webdav.write']({ path: '/', content: 'x' }, context()),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(
      natives['webdav.delete']({ path: '/' }, context()),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(
      natives['webdav.read']({ path: '/' }, context()),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(store.calls).toEqual([]);
  });

  it('refuses input that is not the declared shape', async () => {
    const natives = webdavNatives(stubStore());
    await expect(
      natives['webdav.write']({ path: '/a.md' }, context()),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
});

describe('store refusals reach the caller intact', () => {
  it('refuses to delete content under a legal hold', async () => {
    const store = stubStore({ fail: 'legal-hold' });
    const natives = webdavNatives(store);

    await expect(
      natives['webdav.delete']({ path: '/reports/held.md' }, context()),
    ).rejects.toMatchObject({
      code: 'LIVE_BODY_FAILED',
      message: expect.stringContaining('legal hold'),
    });
  });

  it('refuses to overwrite content under a legal hold', async () => {
    const store = stubStore({ fail: 'legal-hold' });
    const natives = webdavNatives(store);

    await expect(
      natives['webdav.write'](
        { path: '/reports/held.md', content: 'replacement' },
        context(),
      ),
    ).rejects.toMatchObject({
      code: 'LIVE_BODY_FAILED',
      message: expect.stringContaining('legal hold'),
    });
  });

  it('says what a missing parent folder means for a write', async () => {
    const natives = webdavNatives(stubStore({ fail: 'parent-missing' }));
    await expect(
      natives['webdav.write'](
        { path: '/nowhere/summary.md', content: 'x' },
        context(),
      ),
    ).rejects.toMatchObject({
      code: 'LIVE_BODY_FAILED',
      hint: expect.stringContaining('create the folder first'),
    });
  });

  it('distinguishes a folder from a file', async () => {
    const asFile = webdavNatives(stubStore({ fail: 'not-a-file' }));
    await expect(
      asFile['webdav.read']({ path: '/reports' }, context()),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });

    const asFolder = webdavNatives(stubStore({ fail: 'not-a-folder' }));
    await expect(
      asFolder['webdav.list']({ path: '/reports/q3.md' }, context()),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('reports a missing path rather than inventing an empty result', async () => {
    const natives = webdavNatives(stubStore({ fail: 'not-found' }));
    await expect(
      natives['webdav.list']({ path: '/gone' }, context()),
    ).rejects.toMatchObject({ code: 'LIVE_BODY_FAILED' });
  });

  it('lets an unexpected failure through as itself', async () => {
    const store: WebdavStore = {
      list: () => Promise.reject(new Error('the database is on fire')),
      read: () => Promise.reject(new Error('unused')),
      write: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
    };
    await expect(
      webdavNatives(store)['webdav.list']({ path: '/reports' }, context()),
    ).rejects.toThrow('the database is on fire');
  });
});

describe('content handling', () => {
  it('refuses to return a file that is not UTF-8 text', async () => {
    const natives = webdavNatives(
      stubStore({
        file: {
          bytes: new Uint8Array([0xff, 0xfe, 0x00, 0x01]),
          contentType: 'application/octet-stream',
        },
      }),
    );

    await expect(
      natives['webdav.read']({ path: '/reports/logo.png' }, context()),
    ).rejects.toMatchObject({
      code: 'LIVE_BODY_FAILED',
      message: expect.stringContaining('not UTF-8 text'),
    });
  });

  it('falls back to a text content type when the store recorded none', async () => {
    const natives = webdavNatives(
      stubStore({
        file: { bytes: new TextEncoder().encode('plain'), contentType: null },
      }),
    );

    await expect(
      natives['webdav.read']({ path: '/notes.md' }, context()),
    ).resolves.toMatchObject({ contentType: 'text/plain' });
  });

  it('refuses a write above the size ceiling before it reaches the store', async () => {
    const store = stubStore();
    const natives = webdavNatives(store);

    await expect(
      natives['webdav.write'](
        { path: '/big.md', content: 'x'.repeat(MAX_WRITE_BYTES + 1) },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(store.calls).toEqual([]);
  });

  it('passes the read ceiling to the store', async () => {
    let seen = 0;
    const store: WebdavStore = {
      list: () => Promise.resolve([]),
      read: ({ maxBytes }) => {
        seen = maxBytes;
        return Promise.resolve({
          bytes: new TextEncoder().encode('ok'),
          contentType: 'text/plain',
        });
      },
      write: () => Promise.resolve(),
      remove: () => Promise.resolve(true),
    };

    await webdavNatives(store)['webdav.read']({ path: '/a.md' }, context());
    expect(seen).toBeGreaterThan(0);
  });
});
