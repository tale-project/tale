// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getFileMetadata } from './get_file_metadata';

function stubGraph(status: number, body: unknown): string[] {
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

describe('onedrive getFileMetadata', () => {
  it('reads hash, size, mime and the modified stamp', async () => {
    const urls = stubGraph(200, {
      id: 'i1',
      name: 'a.pdf',
      size: 1234,
      lastModifiedDateTime: '2026-01-02T03:04:05Z',
      file: { mimeType: 'application/pdf', hashes: { quickXorHash: 'qx' } },
    });

    const out = await getFileMetadata('i1', 'tok');

    expect(out).toEqual({
      success: true,
      data: {
        hash: 'qx',
        mimeType: 'application/pdf',
        size: 1234,
        modifiedAt: Date.parse('2026-01-02T03:04:05Z'),
      },
    });
    expect(urls[0]).toContain('lastModifiedDateTime');
  });

  it('leaves hash and modified stamp undefined when Graph omits them', async () => {
    stubGraph(200, { id: 'i1', name: 'a.bin', size: 5, file: {} });

    const out = await getFileMetadata('i1', 'tok');

    expect(out.success).toBe(true);
    expect(out.data?.hash).toBeUndefined();
    expect(out.data?.modifiedAt).toBeUndefined();
  });

  it('reports a 404 as not found and any other failure as transient', async () => {
    stubGraph(404, { error: { code: 'itemNotFound' } });
    expect(await getFileMetadata('i1', 'tok')).toMatchObject({
      success: false,
      notFound: true,
    });

    stubGraph(429, { error: { code: 'throttled' } });
    expect(await getFileMetadata('i1', 'tok')).toMatchObject({
      success: false,
      notFound: false,
    });
  });
});
