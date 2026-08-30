import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import type { MutationCtx } from '../_generated/server';
import {
  cleanupRemovedAttachments,
  type TaskAttachmentInput,
  validateTaskAttachments,
} from './attachments';

const ORG = 'org_1';

function img(fileId: string): TaskAttachmentInput {
  return {
    fileId: fileId,
    fileName: 'shot.png',
    fileType: 'image/png',
    fileSize: 1024,
  };
}

/**
 * Mock ctx whose `fileMetadata` by_storageId lookup returns a row in `org` for
 * any storage id in `known`, else null. Mirrors the single-table query shape
 * `validateTaskAttachments` uses (`.query(...).withIndex(...).first()`).
 */
function ctxWith(known: Record<string, string>): MutationCtx {
  return {
    db: {
      query: () => ({
        withIndex: (_name: string, fn: (q: unknown) => unknown) => {
          // Capture the storageId the caller binds via q.eq('storageId', id).
          let storageId = '';
          fn({
            eq: (_field: string, value: string) => {
              storageId = value;
              return {};
            },
          });
          return {
            first: async () =>
              storageId in known
                ? { organizationId: known[storageId], storageId }
                : null,
          };
        },
      }),
    },
  } as unknown as MutationCtx;
}

describe('validateTaskAttachments', () => {
  it('returns undefined when the field is untouched (undefined input)', async () => {
    expect(await validateTaskAttachments(ctxWith({}), ORG, undefined)).toBe(
      undefined,
    );
  });

  it('collapses an empty list to undefined (clears the field)', async () => {
    expect(await validateTaskAttachments(ctxWith({}), ORG, [])).toBe(undefined);
  });

  it('accepts an image owned by the org and trims the name', async () => {
    const long = 'a'.repeat(300);
    const ctx = ctxWith({ s1: ORG });
    const result = await validateTaskAttachments(ctx, ORG, [
      { ...img('s1'), fileName: long },
    ]);
    expect(result).toHaveLength(1);
    expect(result?.[0].fileName).toHaveLength(255);
  });

  it('de-dupes by storage id', async () => {
    const ctx = ctxWith({ s1: ORG });
    const result = await validateTaskAttachments(ctx, ORG, [
      img('s1'),
      img('s1'),
    ]);
    expect(result).toHaveLength(1);
  });

  it('rejects more than the cap', async () => {
    const many = Array.from({ length: 11 }, (_, i) => img(`s${i}`));
    await expect(
      validateTaskAttachments(ctxWith({}), ORG, many),
    ).rejects.toThrow(AppError);
  });

  it('rejects a disallowed MIME type (e.g. video)', async () => {
    const ctx = ctxWith({ s1: ORG });
    await expect(
      validateTaskAttachments(ctx, ORG, [
        { ...img('s1'), fileType: 'video/mp4' },
      ]),
    ).rejects.toThrow(AppError);
  });

  it('accepts text-based files the shared picker offers (md/json/yaml/py)', async () => {
    // Parity with the conversations lane and the client upload hook: the
    // picker's shared accept string offers these, so the server gate must not
    // reject them AFTER the blob upload (which stranded an orphaned blob
    // behind a generic error).
    const ctx = ctxWith({ s1: ORG, s2: ORG, s3: ORG, s4: ORG });
    const result = await validateTaskAttachments(ctx, ORG, [
      { ...img('s1'), fileName: 'notes.md', fileType: 'text/markdown' },
      { ...img('s2'), fileName: 'seed.json', fileType: 'application/json' },
      { ...img('s3'), fileName: 'policy.yaml', fileType: '' },
      { ...img('s4'), fileName: 'transform.py', fileType: 'text/x-python' },
    ]);
    expect(result).toHaveLength(4);
  });

  it('rejects a storage id with no fileMetadata row', async () => {
    await expect(
      validateTaskAttachments(ctxWith({}), ORG, [img('ghost')]),
    ).rejects.toThrow(AppError);
  });

  it('rejects a file owned by another org (forged storage id)', async () => {
    const ctx = ctxWith({ s1: 'org_other' });
    await expect(
      validateTaskAttachments(ctx, ORG, [img('s1')]),
    ).rejects.toThrow(AppError);
  });
});

describe('cleanupRemovedAttachments', () => {
  it('deletes only the storage of dropped attachments', async () => {
    const deleted: string[] = [];
    const ctx = {
      storage: { delete: async (id: string) => void deleted.push(id) },
      db: {
        query: () => ({
          withIndex: () => ({ first: async () => null }),
        }),
      },
    } as unknown as MutationCtx;

    await cleanupRemovedAttachments(
      ctx,
      [img('keep'), img('drop')],
      [img('keep')],
    );
    expect(deleted).toEqual(['drop']);
  });

  it('no-ops when there were no previous attachments', async () => {
    const del = vi.fn();
    const ctx = { storage: { delete: del } } as unknown as MutationCtx;
    await cleanupRemovedAttachments(ctx, undefined, [img('x')]);
    expect(del).not.toHaveBeenCalled();
  });
});
