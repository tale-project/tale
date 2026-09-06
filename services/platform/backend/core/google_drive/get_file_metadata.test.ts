// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getFileMetadata } from './get_file_metadata';

/**
 * The metadata probe is what the sync engine asks "is the source gone?" —
 * a trashed Drive item answers 200 (and lists empty when it is a folder),
 * so it has to read as not-found here or a trashed folder never reaches
 * the terminal state.
 */

function stubDrive(status: number, body: unknown): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      urls.push(input);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('google_drive getFileMetadata', () => {
  it('reads a live binary file: hash, size, mime', async () => {
    const urls = stubDrive(200, {
      id: 'f1',
      name: 'a.pdf',
      size: '1234',
      mimeType: 'application/pdf',
      md5Checksum: 'md5-a',
      trashed: false,
    });

    const out = await getFileMetadata('f1', 'tok');

    expect(out).toEqual({
      success: true,
      data: { hash: 'md5-a', mimeType: 'application/pdf', size: 1234 },
    });
    expect(urls[0]).toContain('trashed');
  });

  it('reports a trashed item as not found', async () => {
    stubDrive(200, {
      id: 'folder-1',
      name: 'Reports',
      mimeType: 'application/vnd.google-apps.folder',
      trashed: true,
    });

    const out = await getFileMetadata('folder-1', 'tok');

    expect(out.success).toBe(false);
    expect(out.notFound).toBe(true);
    expect(out.error).toContain('trash');
  });

  it('reports a 404 as not found and any other failure as transient', async () => {
    stubDrive(404, { error: { code: 404, message: 'File not found' } });
    const gone = await getFileMetadata('f1', 'tok');
    expect(gone).toMatchObject({ success: false, notFound: true });

    stubDrive(503, { error: { code: 503 } });
    const outage = await getFileMetadata('f1', 'tok');
    expect(outage).toMatchObject({ success: false, notFound: false });
  });
});
