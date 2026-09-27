// @vitest-environment node

/**
 * The conversation side of the mail corpus: which messages and which
 * emailed attachments a lane reads as its conversation's mail, and the jobs
 * it queues in its own transaction. Every read binds the one definition of
 * an indexed message and of an emailed attachment, so a lane can never
 * release fewer refs than the indexers wrote.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addJobInTx, markRagQueued } = vi.hoisted(() => ({
  addJobInTx: vi.fn(
    async (_tx: unknown, _name: string, _payload: unknown) => 'job-1',
  ),
  markRagQueued: vi.fn(async (_tx: unknown, _fileId: string) => {}),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));
vi.mock('../knowledge/service.ts', () => ({ markRagQueued }));

import {
  indexedMessageRefsOf,
  mailRefsOf,
  queueMessageRefRelease,
  queueSpamVerdictCorpusJobs,
} from './message-corpus.ts';

const ORG = 'org_1';

/** An emailed attachment: its file row id and its blob ref. */
interface Attachment {
  id: string;
  storageRef: string;
}

function sqlDouble(
  idsByConversation: Record<string, string[]>,
  attachmentsByConversation: Record<string, Attachment[]> = {},
) {
  const reads: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    reads.push({ text, values });
    const conversations = values[1];
    const ids = Array.isArray(conversations) ? conversations.map(String) : [];
    if (text.includes('FROM app.file_metadata')) {
      return Promise.resolve(
        ids.flatMap((id) => attachmentsByConversation[id] ?? []),
      );
    }
    return Promise.resolve(
      ids.flatMap((id) => idsByConversation[id] ?? []).map((id) => ({ id })),
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: tag as unknown as Sql, reads };
}

beforeEach(() => {
  addJobInTx.mockClear();
  markRagQueued.mockClear();
});

describe('indexedMessageRefsOf', () => {
  it('reads the inbound email a connector delivered, as message refs', async () => {
    const { sql, reads } = sqlDouble({ conv_1: ['m1', 'bad id!'] });
    const refs = await indexedMessageRefsOf(sql, ORG, ['conv_1']);
    // An id no ref can carry was never indexed.
    expect(refs).toEqual(['msg:m1']);
    const [read] = reads;
    expect(read?.text).toContain('org_id = ?');
    expect(read?.text).toContain('direction = ?');
    expect(read?.text).toContain('channel = ?');
    expect(read?.text).toContain("connector_name <> ''");
    expect(read?.values.slice(0, 4)).toEqual([
      ORG,
      ['conv_1'],
      'inbound',
      'email',
    ]);
  });

  it('reads nothing for no conversation', async () => {
    const { sql, reads } = sqlDouble({});
    expect(await indexedMessageRefsOf(sql, ORG, [])).toEqual([]);
    expect(reads).toEqual([]);
  });
});

describe('queueMessageRefRelease', () => {
  it('bounds each job, so a retention batch never ships one huge payload', async () => {
    const { sql } = sqlDouble({});
    const refs = Array.from({ length: 1_201 }, (_v, i) => `msg:m${i}`);
    await queueMessageRefRelease(sql, ORG, refs);
    const payloads = addJobInTx.mock.calls.map(
      ([, , payload]) => payload as { refs: string[] },
    );
    expect(payloads.map((payload) => payload.refs.length)).toEqual([
      500, 500, 201,
    ]);
    expect(payloads.flatMap((payload) => payload.refs)).toEqual(refs);
    for (const [tx, name, payload] of addJobInTx.mock.calls) {
      expect(tx).toBe(sql);
      expect(name).toBe('knowledge.release_refs');
      expect(payload).toMatchObject({ organizationId: ORG });
    }
  });

  it('queues nothing for no ref', async () => {
    const { sql } = sqlDouble({});
    await queueMessageRefRelease(sql, ORG, []);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('mailRefsOf', () => {
  it('reads the bodies and the emailed attachments of the conversations', async () => {
    const { sql, reads } = sqlDouble(
      { conv_1: ['m1'] },
      { conv_1: [{ id: 'f1', storageRef: 's3:org/cv.pdf' }] },
    );
    expect(await mailRefsOf(sql, ORG, ['conv_1'])).toEqual([
      'msg:m1',
      's3:org/cv.pdf',
    ]);
    const attachments = reads.find((read) =>
      read.text.includes('FROM app.file_metadata'),
    );
    // A file filed into a document is that document's, never mail.
    expect(attachments?.text).toContain('document_id IS NULL');
    expect(attachments?.text).toContain('conversation_id = ANY(?::text[])');
    expect(attachments?.values.slice(0, 2)).toEqual([ORG, ['conv_1']]);
  });

  it('reads nothing for no conversation', async () => {
    const { sql, reads } = sqlDouble({});
    expect(await mailRefsOf(sql, ORG, [])).toEqual([]);
    expect(reads).toEqual([]);
  });
});

describe('queueSpamVerdictCorpusJobs', () => {
  it('releases what a verdict marks, re-indexes what it lifts, leaves the rest', async () => {
    const { sql, reads } = sqlDouble(
      {
        marked: ['m1'],
        lifted: ['m2', 'm3'],
        closed: ['m4'],
        still: ['m5'],
      },
      {
        marked: [{ id: 'f1', storageRef: 's3:org/marked.pdf' }],
        lifted: [{ id: 'f2', storageRef: 's3:org/lifted.pdf' }],
        closed: [{ id: 'f4', storageRef: 's3:org/closed.pdf' }],
      },
    );
    await queueSpamVerdictCorpusJobs(sql, ORG, [
      { conversationId: 'marked', from: 'open', to: 'spam' },
      { conversationId: 'lifted', from: 'spam', to: 'open' },
      { conversationId: 'closed', from: 'open', to: 'closed' },
      { conversationId: 'still', from: 'spam', to: 'spam' },
    ]);
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([
      // The body and the attachment of the conversation marked spam: their
      // corpus copies go (the attachment's bytes stay with its file row).
      [
        'knowledge.release_refs',
        { organizationId: ORG, refs: ['msg:m1', 's3:org/marked.pdf'] },
      ],
      ['rag.index_message', { messageId: 'm2' }],
      ['rag.index_message', { messageId: 'm3' }],
      // The attachment of the one lifted, queued as the bind queues it.
      ['rag.index_file', { fileId: 'f2' }],
    ]);
    expect(markRagQueued.mock.calls.map(([, fileId]) => fileId)).toEqual([
      'f2',
    ]);
    // The re-index skips an empty body, as the ingest enqueue does, and an
    // attachment opted out of indexing.
    const bodyReads = reads.filter((read) =>
      read.text.includes('FROM app.conversation_messages'),
    );
    expect(bodyReads.map((read) => read.values.at(-1))).toEqual([true, false]);
    const attachmentReads = reads.filter((read) =>
      read.text.includes('FROM app.file_metadata'),
    );
    expect(attachmentReads.map((read) => read.values.at(-1))).toEqual([
      true,
      false,
    ]);
    expect(attachmentReads[1]?.text).toContain(
      'skip_rag_indexing IS DISTINCT FROM true',
    );
    // Nor a trashed one: nothing would index it.
    expect(attachmentReads[1]?.text).toContain("lifecycle_status = 'active'");
  });
});
