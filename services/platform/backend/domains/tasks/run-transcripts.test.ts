// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queueRefRelease } from '../knowledge/release-queue.ts';
import {
  endRunTranscripts,
  endRunTranscriptsAndRelease,
  TASK_RUN_THREAD_KIND,
} from './run-transcripts.ts';

vi.mock('../knowledge/release-queue.ts', () => ({
  queueRefRelease: vi.fn(async () => undefined),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** A transaction answering the trash with the refs it names, recording every
 * statement. */
function fakeTx(refs: string[] = []): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(
      text.startsWith('UPDATE app.file_metadata')
        ? refs.map((ref) => ({ ref }))
        : [],
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the transaction
  return { tx: run as unknown as TransactionSql, statements };
}

beforeEach(() => {
  vi.mocked(queueRefRelease).mockClear();
});

describe('a native run’s transcript ends with its record [TASK-R36]', () => {
  it('is a bare thread of its own kind, which no list of chats shows', () => {
    expect(TASK_RUN_THREAD_KIND).toBe('task_run');
  });

  it('asks nothing for a run that never opened a transcript', async () => {
    const { tx, statements } = fakeTx();

    await expect(
      endRunTranscripts(tx, { organizationId: 'org-1', threadIds: [] }),
    ).resolves.toEqual([]);
    expect(statements).toEqual([]);
  });

  it('trashes what the transcripts held, then deletes the threads, and answers the refs to release', async () => {
    const { tx, statements } = fakeTx(['s3:scratch', 's3:earlier-version']);

    const refs = await endRunTranscripts(tx, {
      organizationId: 'org-1',
      threadIds: ['thread-1', 'thread-2'],
    });

    expect(refs).toEqual(['s3:scratch', 's3:earlier-version']);
    expect(statements).toHaveLength(2);
    const [trash, remove] = statements;
    expect(trash?.text).toContain("lifecycle_status = 'trashed'");
    expect(trash?.text).toContain('thread_id = ANY');
    // Only what is live is trashed again: a row already ended keeps its date.
    expect(trash?.text).toContain(
      "(lifecycle_status IS NULL OR lifecycle_status = 'active')",
    );
    expect(trash?.values).toContainEqual(['thread-1', 'thread-2']);
    expect(remove?.text).toBe(
      'DELETE FROM app.threads WHERE org_id = ? AND id = ANY(?)',
    );
    expect(remove?.values).toEqual(['org-1', ['thread-1', 'thread-2']]);
  });

  it('takes the files the transcript binds and no deliverable, which belongs to its task and is no longer bound to it', async () => {
    const { tx, statements } = fakeTx();

    await endRunTranscripts(tx, {
      organizationId: 'org-1',
      threadIds: ['thread-1'],
    });

    // A deliverable's row has let go of the thread (`saveAgentFileMetadata`),
    // so the thread binding is all this needs to name.
    expect(statements[0]?.text).not.toContain('task-output');
  });

  it('queues the bytes of what it trashed for release in the same transaction, and counts the transcripts ended', async () => {
    const { tx } = fakeTx(['s3:scratch']);

    await expect(
      endRunTranscriptsAndRelease(tx, {
        organizationId: 'org-1',
        threadIds: ['thread-1'],
      }),
    ).resolves.toBe(1);

    expect(queueRefRelease).toHaveBeenCalledExactlyOnceWith(tx, 'org-1', [
      's3:scratch',
    ]);
  });
});
