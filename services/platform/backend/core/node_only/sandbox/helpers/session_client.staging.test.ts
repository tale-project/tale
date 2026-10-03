import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStageFiles, type SessionStageFile } from './session_client';

beforeEach(() => {
  vi.stubEnv('SANDBOX_TOKEN', 'staging-test');
  vi.stubEnv('SANDBOX_URL', 'http://sandbox.test');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

interface StageBody {
  files: SessionStageFile[];
  replaceRoots?: string[];
  keepPaths?: string[];
}

describe('managed staging transport', () => {
  it('retries only admission refusals and preserves a single deadline across attempts', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: 'busy' }, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          staged: [],
          skipped: [{ path: 'inputs/a', reason: 'busy' }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          staged: [{ path: 'inputs/a', bytes: 1 }],
          skipped: [],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await sessionStageFiles('s', [
      { path: 'inputs/a', contentBase64: 'YQ==' },
    ]);
    expect(result.staged).toEqual([{ path: 'inputs/a', bytes: 1 }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    expect(fetcher.mock.calls.every((call) => call[1]?.signal === signal)).toBe(
      true,
    );
    fetcher
      .mockReset()
      .mockResolvedValue(
        Response.json({ error: 'session_unavailable' }, { status: 503 }),
      );
    await expect(
      sessionStageFiles('s', [{ path: 'inputs/a', contentBase64: 'YQ==' }]),
    ).rejects.toThrow('(503)');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops admission retries when the batch deadline is aborted', async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      return Response.json({ error: 'busy' }, { status: 503 });
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(
        sessionStageFiles('s', [{ path: 'inputs/a', contentBase64: 'YQ==' }]),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });
  it('caller cancellation reaches an active transfer and prevents later batches', async () => {
    const controller = new AbortController();
    const called = Promise.withResolvers<void>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        called.resolve();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          );
        });
      });
    vi.stubGlobal('fetch', fetcher);
    const result = sessionStageFiles(
      's',
      Array.from({ length: 513 }, (_, index) => ({
        path: `inputs/${index}`,
        contentBase64: 'YQ==',
      })),
      { signal: controller.signal },
    ).catch((error: unknown) => error);
    await called.promise;
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('caller cancellation stops the admission retry wait without another request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      return Response.json({ error: 'busy' }, { status: 503 });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(
      sessionStageFiles('s', [{ path: 'inputs/a', contentBase64: 'YQ==' }], {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('batches both tiny source probes and transfers within the runtime item limit', async () => {
    const sizes: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        const body = JSON.parse(
          typeof init?.body === 'string' ? init.body : '',
        ) as StageBody;
        sizes.push(body.files.length);
        return Response.json({
          staged: [],
          skipped: body.files.map((file) => ({
            path: file.path,
            reason: 'no_source',
          })),
        });
      }),
    );
    await sessionStageFiles(
      's',
      Array.from({ length: 1025 }, (_, i) => ({
        path: `inputs/${i}`,
        contentBase64: 'YQ==',
      })),
      { reuse: true },
    );
    expect(sizes).toEqual([512, 512, 1, 512, 512, 1]);
  });
  it('transfers only misses and reconciles the complete desired manifest after staging', async () => {
    const calls: StageBody[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        const body = JSON.parse(
          typeof init?.body === 'string' ? init.body : '',
        ) as StageBody;
        calls.push(body);
        if (calls.length === 1)
          return Response.json({
            staged: [{ path: 'inputs/kept', bytes: 4 }],
            skipped: [{ path: 'inputs/new', reason: 'no_source' }],
          });
        return Response.json({
          staged: body.files.map((file) => ({ path: file.path, bytes: 4 })),
          skipped: [],
          ...(body.replaceRoots ? { reconciled: true } : {}),
        });
      }),
    );
    const result = await sessionStageFiles(
      's',
      [
        {
          path: 'inputs/kept',
          contentBase64: Buffer.from('same').toString('base64'),
        },
        {
          path: 'inputs/new',
          contentBase64: Buffer.from('next').toString('base64'),
        },
      ],
      { reuse: true, replaceRoots: ['inputs'] },
    );
    expect(calls).toHaveLength(3);
    expect(
      calls[0]?.files.every(
        (file) =>
          file.contentBase64 === undefined &&
          file.sourceId?.startsWith('sha256:'),
      ),
    ).toBe(true);
    expect(calls[1]?.files.map((file) => file.path)).toEqual(['inputs/new']);
    expect(calls[2]).toEqual({
      files: [],
      replaceRoots: ['inputs'],
      keepPaths: ['inputs/kept', 'inputs/new'],
    });
    expect(result.staged.map((file) => file.path)).toEqual([
      'inputs/kept',
      'inputs/new',
    ]);
  });

  it('does not prune an old managed tree when a transfer failed', async () => {
    const bodies: StageBody[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        bodies.push(
          JSON.parse(
            typeof init?.body === 'string' ? init.body : '',
          ) as StageBody,
        );
        return Response.json({
          staged: [],
          skipped: [{ path: 'inputs/a', reason: 'source unavailable' }],
        });
      }),
    );
    const result = await sessionStageFiles(
      's',
      [{ path: 'inputs/a', url: 'https://source.test/a' }],
      { replaceRoots: ['inputs'] },
    );
    expect(result.skipped).toHaveLength(1);
    expect(bodies).toHaveLength(1);
  });

  it('does not start legacy clear-and-copy after the staging caller cancels', async () => {
    const controller = new AbortController();
    const paths: string[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = url instanceof Request ? url.url : url.toString();
      paths.push(path);
      if (paths.length === 2) controller.abort();
      if (path.endsWith('/delete'))
        return Response.json({ deleted: ['inputs'], skipped: [] });
      return Response.json({ staged: [], skipped: [] });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(
      sessionStageFiles('s', [{ path: 'inputs/a', contentBase64: 'YQ==' }], {
        replaceRoots: ['inputs'],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(paths).toHaveLength(2);
    expect(paths.some((path) => path.endsWith('/delete'))).toBe(false);
  });

  it('falls back to clear-and-copy when an old runtime cannot reconcile', async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        paths.push(url instanceof Request ? url.url : url.toString());
        const body = JSON.parse(
          typeof init?.body === 'string' ? init.body : '',
        ) as StageBody & { paths?: string[] };
        return body.paths
          ? Response.json({ deleted: body.paths, skipped: [] })
          : Response.json({
              staged: body.files.map((file) => ({ path: file.path, bytes: 1 })),
              skipped: [],
            });
      }),
    );
    await sessionStageFiles(
      's',
      [{ path: 'inputs/a', contentBase64: 'YQ==' }],
      { replaceRoots: ['inputs'] },
    );
    expect(paths.map((path) => path.split('/').at(-1))).toEqual([
      'stage',
      'stage',
      'delete',
      'stage',
    ]);
  });

  it('removes deleted sources even when the desired managed tree is empty', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ staged: [], skipped: [], reconciled: true }),
      );
    vi.stubGlobal('fetch', fetcher);
    await sessionStageFiles('s', [], { replaceRoots: ['inputs'] });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
      files: [],
      replaceRoots: ['inputs'],
      keepPaths: [],
    });
  });
});
