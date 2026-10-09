// @vitest-environment node

/**
 * `POST /files/register` is the door every staged upload walks through — the
 * chat composer's, a task's, the welcome page's. The 0.4 mutation it replaced
 * queued RAG indexing for documents right here (`shouldIndex`); the port kept
 * only the audio branch, so a document attached in chat sat with a NULL
 * `rag_status` forever and every turn told the model the file was "not
 * machine-readable". These tests pin the enqueue — and the three shapes that
 * must NOT take it. A file no lane will index and no extractor reads (a
 * `.doc`, a `.zip`, a hand-uploaded `.loop`) lands on the terminal state the
 * indexer and a sync import give it — in an existing thread exactly as in a
 * fresh chat, whose first attachments register before the thread exists —
 * while audio, video and opted-out files, and a `.log` the indexer reads,
 * keep an empty status. No list shows these rows, so no status write here
 * makes the organization's open Documents lists refetch.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { RAG_ERROR_UNSUPPORTED_TYPE } from '../../core/knowledge/rag_error_codes.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { markRagQueued } from '../knowledge/service.ts';
import { HELD_BY_DOCUMENT_SQL } from '../knowledge/status-hints.ts';
import { createFileRoutes } from './routes.ts';
import { registerUpload, stampImageVisionMetadata } from './service.ts';
import { queueTranscription } from './transcription.ts';

/** The register transaction, recording what runs on it. The queue marker and
 * the page-shape stamp stay mocked, so a statement here is the status
 * writer's, run for real. A freshly registered upload is held by no
 * document, so every statement answers the writer's list probe with false —
 * whatever its SQL says. */
const db = vi.hoisted(() => {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ text: strings.join('$'), values });
    return Promise.resolve([{ orgId: 'org_1', listed: false }]);
  };
  const tx = Object.assign(tag, { unsafe: (raw: string) => raw });
  return { statements, tx };
});

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
    (_sql: unknown, run: (tx: unknown) => Promise<unknown>) => run(db.tx),
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
vi.mock('../knowledge/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../knowledge/service.ts')>()),
  markRagQueued: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job_1')),
}));
vi.mock('../../realtime/outbox.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime/outbox.ts')>()),
  emitHintInTx: vi.fn(() => Promise.resolve()),
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

/** The status writer's statements: the ones that ask, in the write itself,
 * whether a document holds the file. */
const statusWrites = () =>
  db.statements.filter((s) => s.values.includes(HELD_BY_DOCUMENT_SQL));

const hints = () => vi.mocked(emitHintInTx).mock.calls;

afterEach(() => {
  vi.clearAllMocks();
  db.statements.length = 0;
});

describe('POST /files/register', () => {
  it('rejects the reserved product-image source before trusting declared image metadata', async () => {
    const res = await register({
      fileName: 'fake.png',
      contentType: 'image/png',
      source: 'product-image',
      skipRagIndexing: true,
    });

    expect(res.status).toBe(400);
    // Named, not zod's bare "Invalid input" for a refine with no sentence.
    expect(((await res.json()) as { message: string }).message).toBe(
      'source: is reserved for the product image upload',
    );
    expect(registerUpload).not.toHaveBeenCalled();
    expect(stampImageVisionMetadata).not.toHaveBeenCalled();
  });

  it('queues indexing for a document, in the transaction that wrote the row [FILE-R8]', async () => {
    const res = await register({ threadId: 'thread_1' });

    expect(res.status).toBe(200);
    expect(registerUpload).toHaveBeenCalledTimes(1);
    expect(markRagQueued).toHaveBeenCalledWith(db.tx, 'file_1');
    expect(addJobInTx).toHaveBeenCalledWith(db.tx, 'rag.index_file', {
      fileId: 'file_1',
    });
    expect(queueTranscription).not.toHaveBeenCalled();
  });

  it('leaves an image unindexed and stamps its page shape instead [FILE-R8]', async () => {
    const res = await register({
      fileName: 'screenshot.png',
      contentType: 'image/png',
    });

    expect(res.status).toBe(200);
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(stampImageVisionMetadata).toHaveBeenCalledWith(db.tx, 'file_1');
  });

  it('sends audio to transcription, never to the corpus [FILE-R8]', async () => {
    const res = await register({
      fileName: 'memo.m4a',
      contentType: 'audio/mp4',
    });

    expect(res.status).toBe(200);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(stampImageVisionMetadata).not.toHaveBeenCalled();
    expect(queueTranscription).toHaveBeenCalledTimes(1);
  });

  it('honours the caller opt-out and writes it onto the row [FILE-R8]', async () => {
    const res = await register({ skipRagIndexing: true });

    expect(res.status).toBe(200);
    expect(registerUpload).toHaveBeenCalledWith(
      expect.anything(),
      db.tx,
      { organizationId: 'org_1', userId: 'user_1' },
      expect.objectContaining({ skipRagIndexing: true }),
      { kind: 'app', purpose: 'file' },
    );
    expect(markRagQueued).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('hands a new chat’s project to the registration, which checks it [GOV-R14]', async () => {
    const res = await register({
      fileName: 'memo.m4a',
      contentType: 'audio/mp4',
      projectId: 'project_1',
    });

    expect(res.status).toBe(200);
    expect(registerUpload).toHaveBeenCalledWith(
      expect.anything(),
      db.tx,
      { organizationId: 'org_1', userId: 'user_1' },
      expect.objectContaining({ projectId: 'project_1' }),
      { kind: 'app', purpose: 'file' },
    );
  });
});

describe('POST /files/register — a file no lane will index', () => {
  it.each([
    ['a hand-uploaded Loop page', 'standup.loop', 'application/octet-stream'],
    ['a legacy Word file', 'minutes.doc', 'application/msword'],
    ['an archive', 'bundle.zip', 'application/zip'],
  ])(
    'lands %s on unsupported_type with the indexer’s sentence, never queued [FILE-R8]',
    async (_label, fileName, contentType) => {
      const res = await register({ fileName, contentType });

      expect(res.status).toBe(200);
      const writes = statusWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0]?.values).toEqual(
        expect.arrayContaining([
          'unsupported',
          `No text extractor exists for "${fileName}".`,
          RAG_ERROR_UNSUPPORTED_TYPE,
          'file_1',
        ]),
      );
      // An attachment is on no document list: the writer asks (that is how
      // `statusWrites` finds it), and the organization's open Documents
      // lists are not told to refetch.
      expect(hints()).toEqual([]);
      expect(markRagQueued).not.toHaveBeenCalled();
      expect(addJobInTx).not.toHaveBeenCalled();
      expect(queueTranscription).not.toHaveBeenCalled();
    },
  );

  // A fresh chat registers its first attachments before the thread exists;
  // a later message in the same chat registers them with its thread id. The
  // same file must read the same either way — it used to be terminal in the
  // first case and empty for good in the second.
  it.each([
    ['a legacy Word file', 'minutes.doc', 'application/msword'],
    ['a hand-uploaded Loop page', 'standup.loop', 'application/octet-stream'],
  ])(
    'gives %s in an existing thread the status it gets in a fresh chat',
    async (_label, fileName, contentType) => {
      await register({ fileName, contentType });
      const freshChat = statusWrites().map((s) => s.values);
      db.statements.length = 0;

      const res = await register({
        fileName,
        contentType,
        threadId: 'thread_1',
      });

      expect(res.status).toBe(200);
      expect(freshChat).toHaveLength(1);
      expect(statusWrites().map((s) => s.values)).toEqual(freshChat);
      expect(hints()).toEqual([]);
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );

  // `isSupported` is false for media too: without the exclusion a recording
  // would read "Not supported" while its transcript is being made.
  it.each([
    ['audio', 'memo.m4a', 'audio/mp4'],
    ['video', 'standup.mp4', 'video/mp4'],
  ])(
    'leaves %s to the transcription lane',
    async (_label, fileName, contentType) => {
      const res = await register({ fileName, contentType });

      expect(res.status).toBe(200);
      expect(statusWrites()).toEqual([]);
      expect(queueTranscription).toHaveBeenCalledTimes(1);
    },
  );

  it('leaves a chat-bound recording to the transcription lane too', async () => {
    const res = await register({
      fileName: 'memo.m4a',
      contentType: 'audio/mp4',
      threadId: 'thread_1',
    });

    expect(res.status).toBe(200);
    expect(statusWrites()).toEqual([]);
    expect(queueTranscription).toHaveBeenCalledTimes(1);
  });

  it('leaves an opted-out file alone', async () => {
    const res = await register({
      fileName: 'standup.loop',
      contentType: 'application/octet-stream',
      skipRagIndexing: true,
    });

    expect(res.status).toBe(200);
    expect(statusWrites()).toEqual([]);
  });

  it.each([undefined, 'thread_1'])(
    'keeps a `.log` on its empty status: the indexer reads it, so it is not terminal (thread %s)',
    async (threadId) => {
      const res = await register({
        fileName: 'server.log',
        contentType: 'text/plain',
        ...(threadId !== undefined ? { threadId } : {}),
      });

      expect(res.status).toBe(200);
      expect(statusWrites()).toEqual([]);
      expect(markRagQueued).not.toHaveBeenCalled();
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );
});
