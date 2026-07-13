import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionListFiles = vi.fn();
const sessionReadFile = vi.fn();

vi.mock('./helpers/session_client', () => ({
  sessionListFiles: (...args: unknown[]) => sessionListFiles(...args),
  sessionReadFile: (...args: unknown[]) => sessionReadFile(...args),
}));

vi.mock('../../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_mutations: {
        saveFileMetadata: 'file_metadata/internal_mutations:saveFileMetadata',
      },
    },
  },
}));

import { harvestSandboxOutput } from './workflow_sandbox_exec';

function mockCtx() {
  const stored: Array<{ type: string; size: number }> = [];
  const mutations: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  const raw = {
    storage: {
      store: (blob: Blob) => {
        stored.push({ type: blob.type, size: blob.size });
        return Promise.resolve(`storage_${stored.length}`);
      },
    },
    runMutation: (ref: unknown, args: Record<string, unknown>) => {
      mutations.push({ ref, args });
      return Promise.resolve(undefined);
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- harvest only needs store + runMutation
  const ctx = raw as unknown as Parameters<typeof harvestSandboxOutput>[0];
  return { ctx, stored, mutations };
}

describe('harvestSandboxOutput', () => {
  beforeEach(() => {
    sessionListFiles.mockReset();
    sessionReadFile.mockReset();
  });

  it('stores each output file AND writes fileMetadata so document.create can resolve it', async () => {
    sessionListFiles.mockResolvedValue([
      { name: 'transform.py', type: 'file' },
      { name: 'summary.md', type: 'file' },
    ]);
    sessionReadFile.mockImplementation((_sid: string, path: string) => {
      const name = path.split('/').pop() ?? path;
      const body = name === 'summary.md' ? '# done' : 'print("hello")\n';
      return Promise.resolve({
        bytes: new TextEncoder().encode(body).buffer,
        contentType: 'application/octet-stream',
      });
    });

    const { ctx, stored, mutations } = mockCtx();
    const out = await harvestSandboxOutput(
      ctx,
      'sess-1',
      'output',
      undefined,
      'org-1',
    );

    expect(out.outputFiles).toEqual([
      { name: 'transform.py', storageId: 'storage_1' },
      { name: 'summary.md', storageId: 'storage_2' },
    ]);
    expect(out.summaryWritten).toBe(true);
    expect(out.summary).toBe('# done');

    // Extension-derived content types (spawner returned octet-stream).
    expect(stored.map((s) => s.type)).toEqual([
      'text/plain; charset=utf-8',
      'text/markdown; charset=utf-8',
    ]);

    expect(mutations).toHaveLength(2);
    expect(mutations[0]?.args).toMatchObject({
      organizationId: 'org-1',
      storageId: 'storage_1',
      fileName: 'transform.py',
      source: 'agent',
    });
    expect(mutations[1]?.args).toMatchObject({
      organizationId: 'org-1',
      storageId: 'storage_2',
      fileName: 'summary.md',
      source: 'agent',
    });
  });

  it('still returns harvested files when saveFileMetadata fails', async () => {
    sessionListFiles.mockResolvedValue([
      { name: 'transform.py', type: 'file' },
    ]);
    sessionReadFile.mockResolvedValue({
      bytes: new TextEncoder().encode('x').buffer,
      contentType: 'text/plain',
    });
    const { ctx, mutations } = mockCtx();
    // Force metadata write to throw after the first store.
    ctx.runMutation = () => Promise.reject(new Error('metadata down'));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = await harvestSandboxOutput(
      ctx,
      'sess-1',
      'output',
      undefined,
      'org-1',
    );
    warn.mockRestore();

    expect(out.outputFiles).toEqual([
      { name: 'transform.py', storageId: 'storage_1' },
    ]);
    expect(mutations).toHaveLength(0);
  });
});
