// @vitest-environment node

/**
 * A controlled document's replacement upload carries the file's
 * `lastModified`, which the finalize stores as the document's modified date,
 * and the begin door took any number: `9e15` (an instant no `Date` can
 * hold), a negative or a fractional millisecond was kept on the intent and
 * then on the document. The door now holds it to `epochMsSchema` and
 * refuses the rest with its 400 before an intent is minted.
 */

import { EPOCH_MS_MAX } from '@tale/shared/schemas/epoch-ms';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { beginReplacementUpload, getProjectAuthContext } = vi.hoisted(() => ({
  beginReplacementUpload: vi.fn(),
  getProjectAuthContext: vi.fn(),
}));

vi.mock('./replacement.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replacement.ts')>()),
  beginReplacementUpload,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext,
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'member' } as never);
      await next();
    },
}));

import { createDocumentRoutes } from './routes.ts';

async function begin(lastModified: unknown): Promise<Response> {
  return await createDocumentRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request('/doc-1/replacement-upload/begin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRecordState: 'draft',
      expectedVersion: 1,
      expectedFileId: 's3:blob-1',
      fileName: 'policy.pdf',
      lastModified,
    }),
  });
}

beforeEach(() => {
  getProjectAuthContext.mockReset().mockResolvedValue({ organizationId: 'o1' });
  beginReplacementUpload.mockReset().mockResolvedValue({ intentId: 'i1' });
});

describe('the replacement upload holds lastModified to the epoch bound', () => {
  it.each([9e15, EPOCH_MS_MAX + 1, -1, 1_790_400_000_000.5, '1790400000000'])(
    'refuses lastModified %s with a 400',
    async (lastModified) => {
      const res = await begin(lastModified);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid body' });
      expect(beginReplacementUpload).not.toHaveBeenCalled();
    },
  );

  it('begins with the latest instant a Date can hold', async () => {
    const res = await begin(EPOCH_MS_MAX);
    expect(res.status).toBe(200);
    expect(beginReplacementUpload).toHaveBeenCalledWith(
      {},
      { organizationId: 'o1' },
      expect.objectContaining({
        documentId: 'doc-1',
        lastModified: EPOCH_MS_MAX,
      }),
      expect.any(String),
    );
  });
});
