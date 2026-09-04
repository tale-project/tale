// @vitest-environment node

/**
 * Terminal writes on a video-link job are conditional. The captions
 * finalizer used to patch `completed` unconditionally: a cancel landing
 * during the seconds-wide transcript store (its `skipped` write and blob
 * delete already done) was overwritten, and the chip came back Ready over a
 * file row whose bytes were gone. The finalizer's patch is now a CAS on
 * `indexing` inside the transaction that inserts the file row — a lost CAS
 * rolls everything back and reaps the orphan blob — and the cancel itself is
 * a CAS on the state the user saw, so a job that settled on its own is left
 * as it settled. The real-Postgres arc rides the integration check.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { deleteOrgBlobRefs } from '../files/service.ts';
import { markRagQueued } from '../knowledge/service.ts';
import {
  cancelVideoLink,
  finalizeClonedTranscript,
  insertSyntheticFileMetadata,
} from './service.ts';

vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: vi.fn(() => Promise.resolve()),
  putOrgBlobBytes: vi.fn(),
}));
vi.mock('../knowledge/service.ts', () => ({
  markRagQueued: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve()),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
}));

interface Statement {
  text: string;
  values: unknown[];
}

const FRAGMENT = Symbol('fragment');

interface Fragment {
  [FRAGMENT]: true;
  text: string;
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

function jobRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'job-1',
    organizationId: 'org-1',
    threadId: null,
    uploadedBy: 'user-1',
    status: 'indexing',
    statusChangedAt: Date.now(),
    storageRef: null,
    fileMetadataId: null,
    messageBoundAt: null,
    attempts: 0,
    errorReasonCode: null,
    ...overrides,
  };
}

/**
 * Scripted `sql`: job reads pop `jobs`, job patches pop `updates` (an empty
 * answer is a CAS miss — the follow-up existence read answers "still
 * there"), the file insert answers one id. `begin` records COMMIT or
 * ROLLBACK so the transactional outcome is observable.
 */
function fakeJobs(script: {
  jobs: Record<string, unknown>[];
  updates: { id: string }[][];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    let rows: unknown[] = [];
    if (text.startsWith('SELECT id, org_id AS "organizationId"')) {
      rows = script.jobs.length > 0 ? [script.jobs.shift()] : [];
    } else if (text.startsWith('INSERT INTO app.file_metadata')) {
      rows = [{ id: 'fm-1' }];
    } else if (text.startsWith('UPDATE app.video_link_jobs SET')) {
      rows = script.updates.shift() ?? [];
    } else if (text.startsWith('SELECT id FROM app.video_link_jobs WHERE id')) {
      rows = [{ id: 'job-1' }];
    }
    return Promise.resolve(rows);
  };
  tag.unsafe = (text: string): Fragment => ({ [FRAGMENT]: true, text });
  tag.begin = async (
    callback: (tx: typeof tag) => unknown,
  ): Promise<unknown> => {
    try {
      const result = await callback(tag);
      statements.push({ text: 'COMMIT', values: [] });
      return result;
    } catch (error) {
      statements.push({ text: 'ROLLBACK', values: [] });
      throw error;
    }
  };
  return { sql: tag as unknown as Sql, statements };
}

const captionsArgs = {
  jobId: 'job-1',
  storageId: 's3:acme/transcript-1',
  transcript: 'hello world',
  fileSize: 11,
  videoTitle: 'Talk',
  videoDurationSec: 60,
  sourceUrl: 'https://videos.test/1',
  sourcePlatform: 'youtube',
  transcriptSource: 'captions_auto',
  organizationId: 'org-1',
  uploadedBy: 'user-1',
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('insertSyntheticFileMetadata', () => {
  it('rolls back and reaps the blob when a cancel landed before the terminal patch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeJobs({ jobs: [jobRow({})], updates: [[]] });

    const result = await insertSyntheticFileMetadata(fake.sql, captionsArgs);

    expect(result).toBeNull();
    const patch = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.video_link_jobs SET'),
    );
    // The patch is a CAS: `completed` lands only over `indexing`.
    expect(patch?.values).toContain('completed');
    expect(patch?.values).toContain('indexing');
    expect(fake.statements.map((s) => s.text)).toContain('ROLLBACK');
    expect(fake.statements.map((s) => s.text)).not.toContain('COMMIT');
    expect(deleteOrgBlobRefs).toHaveBeenCalledWith(fake.sql, 'org-1', [
      's3:acme/transcript-1',
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("left 'indexing' before its finalizer landed"),
    );
  });

  it('lands the file row, the RAG job and the completed patch in one committed transaction', async () => {
    const fake = fakeJobs({ jobs: [jobRow({})], updates: [[{ id: 'job-1' }]] });

    const result = await insertSyntheticFileMetadata(fake.sql, captionsArgs);

    expect(result).toBe('fm-1');
    expect(fake.statements.map((s) => s.text)).toContain('COMMIT');
    expect(markRagQueued).toHaveBeenCalledWith(expect.anything(), 'fm-1');
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'rag.index_file',
      {
        fileId: 'fm-1',
      },
    );
    expect(deleteOrgBlobRefs).not.toHaveBeenCalled();
  });

  it('writes nothing for a job that already left indexing before it started', async () => {
    const fake = fakeJobs({
      jobs: [jobRow({ status: 'skipped' })],
      updates: [],
    });

    const result = await insertSyntheticFileMetadata(fake.sql, captionsArgs);

    expect(result).toBeNull();
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('INSERT INTO app.file_metadata'),
      ),
    ).toBe(false);
    expect(deleteOrgBlobRefs).toHaveBeenCalledWith(fake.sql, 'org-1', [
      's3:acme/transcript-1',
    ]);
  });
});

describe('finalizeClonedTranscript', () => {
  it('rolls back and reaps the blob on a lost CAS inside the transaction', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeJobs({ jobs: [jobRow({})], updates: [[]] });

    const result = await finalizeClonedTranscript(fake.sql, {
      jobId: 'job-1',
      storageId: 's3:acme/clone-1',
      organizationId: 'org-1',
      transcript: 'donor text',
      fileName: 'donor.txt',
      fileSize: 10,
    });

    expect(result).toBeNull();
    expect(fake.statements.map((s) => s.text)).toContain('ROLLBACK');
    expect(deleteOrgBlobRefs).toHaveBeenCalledWith(fake.sql, 'org-1', [
      's3:acme/clone-1',
    ]);
  });
});

describe('cancelVideoLink', () => {
  const cancelArgs = {
    organizationId: 'org-1',
    userId: 'user-1',
    jobId: 'job-1',
  };

  it('leaves a job alone that completed while the cancel was in flight', async () => {
    const fake = fakeJobs({
      // Seen `indexing`; by the time the CAS runs the finalizer settled it.
      jobs: [
        jobRow({}),
        jobRow({ status: 'completed', storageRef: 's3:acme/t' }),
      ],
      updates: [[]],
    });

    await cancelVideoLink(fake.sql, cancelArgs);

    const patches = fake.statements.filter((s) =>
      s.text.startsWith('UPDATE app.video_link_jobs SET'),
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]?.values).toContain('skipped');
    expect(patches[0]?.values).toContain('indexing');
    expect(deleteOrgBlobRefs).not.toHaveBeenCalled();
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('DELETE FROM app.file_metadata'),
      ),
    ).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('cancels a job that merely advanced, in the state it advanced to', async () => {
    const fake = fakeJobs({
      jobs: [
        jobRow({ status: 'fetching_captions' }),
        jobRow({ status: 'indexing' }),
        // The cleanup's own read after the cancel landed.
        jobRow({ status: 'skipped' }),
      ],
      updates: [[], [{ id: 'job-1' }]],
    });

    await cancelVideoLink(fake.sql, cancelArgs);

    const patches = fake.statements.filter((s) =>
      s.text.startsWith('UPDATE app.video_link_jobs SET'),
    );
    expect(patches).toHaveLength(2);
    expect(patches[0]?.values).toContain('fetching_captions');
    expect(patches[1]?.values).toContain('indexing');
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });
});
