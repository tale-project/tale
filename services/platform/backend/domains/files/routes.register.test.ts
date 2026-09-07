// @vitest-environment node

/**
 * `POST /files/register` is the door every staged upload walks through — the
 * chat composer's, a task's, the welcome page's. The 0.4 mutation it replaced
 * queued RAG indexing for documents right here (`shouldIndex`); the port kept
 * only the audio branch, so a document attached in chat sat with a NULL
 * `rag_status` forever and every turn told the model the file was "not
 * machine-readable". These tests pin the enqueue — and the three shapes that
 * must NOT take it.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { markRagQueued } from '../knowledge/service.ts';
import { createFileRoutes } from './routes.ts';
import { registerUpload, stampImageVisionMetadata } from './service.ts';
import { queueTranscription } from './transcription.ts';

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('sessionBundle', { user: { id: 'user_1' } });
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('orgId', 'org_1');
      c.set('orgMember', { role: 'member' });
      await next();
    },
}));
vi.mock('../../lib/rate-limit.ts', () => ({
  checkUserRateLimit: vi.fn(() => Promise.resolve()),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: vi.fn(
    (_sql: unknown, run: (tx: unknown) => Promise<unknown>) => run('tx'),
  ),
}));
vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    registerUpload: vi.fn(() =>
      Promise.resolve({ fileId: 'file_1', size: 2879 }),
    ),
    stampImageVisionMetadata: vi.fn(() => Promise.resolve()),
  };
});
vi.mock('../knowledge/service.ts', () => ({
  markRagQueued: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job_1')),
}));
vi.mock('./transcription.ts', () => ({
  queueTranscription: vi.fn(() => Promise.resolve()),
  retryTranscription: vi.fn(() => Promise.resolve()),
  skipTranscription: vi.fn(() => Promise.resolve()),
  transcribeDictation: vi.fn(() => Promise.resolve()),
}));

function register(body: Record<string, unknown>) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mocked middleware never touches either dependency
  return createFileRoutes({ sql: {} as Sql, auth: {} as Auth }).request(
    '/register',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        storageRef: 's3:blobs/acme/staged',
        fileName: 'practice.md',
        contentType: 'text/markdown',
        ...body,
      }),
    },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /files/register', () => {
  it('queues indexing for a document, in the transaction that wrote the row', async () => {
    const res = await register({ threadId: 'thread_1' });

    expect(res.status).toBe(200);
    expect(registerUpload).toHaveBeenCalledTimes(1);
    expect(markRagQueued).toHaveBeenCalledWith('tx', 'file_1');
    expect(addJobInTx).toHaveBeenCalledWith('tx', 'rag.index_file', {
      fileId: 'file_1',
    });
    expect(queueTranscription).not.toHaveBeenCalled();
  });

  it('leaves an image unindexed and stamps its page shape instead', async () => {
    const res = await register({
      fileName: 'screenshot.png',
      contentType: 'image/png',
    });

    expect(res.status).toBe(200);
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(stampImageVisionMetadata).toHaveBeenCalledWith('tx', 'file_1');
  });

  it('sends audio to transcription, never to the corpus', async () => {
    const res = await register({
      fileName: 'memo.m4a',
      contentType: 'audio/mp4',
    });

    expect(res.status).toBe(200);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(stampImageVisionMetadata).not.toHaveBeenCalled();
    expect(queueTranscription).toHaveBeenCalledTimes(1);
  });

  it('honours the caller opt-out and writes it onto the row', async () => {
    const res = await register({ skipRagIndexing: true });

    expect(res.status).toBe(200);
    expect(registerUpload).toHaveBeenCalledWith(
      expect.anything(),
      'tx',
      { organizationId: 'org_1', userId: 'user_1' },
      expect.objectContaining({ skipRagIndexing: true }),
      { kind: 'app', purpose: 'file' },
    );
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
