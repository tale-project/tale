// @vitest-environment node

/**
 * The conversation side of the email-body corpus: which messages a lane
 * reads as indexed, and the jobs it queues in its own transaction. Every
 * read binds the one definition of an indexed message, so a lane can never
 * release fewer refs than the indexer wrote.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addJobInTx } = vi.hoisted(() => ({
  addJobInTx: vi.fn(
    async (_tx: unknown, _name: string, _payload: unknown) => 'job-1',
  ),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));

import {
  indexedMessageRefsOf,
  queueMessageRefRelease,
  queueSpamVerdictCorpusJobs,
} from './message-corpus.ts';

const ORG = 'org_1';

function sqlDouble(idsByConversation: Record<string, string[]>) {
  const reads: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    reads.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    const conversations = values[1];
    const ids = Array.isArray(conversations)
      ? conversations.flatMap((id) => idsByConversation[String(id)] ?? [])
      : [];
    return Promise.resolve(ids.map((id) => ({ id })));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: tag as unknown as Sql, reads };
}

beforeEach(() => {
  addJobInTx.mockClear();
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

describe('queueSpamVerdictCorpusJobs', () => {
  it('releases what a verdict marks, re-indexes what it lifts, leaves the rest', async () => {
    const { sql, reads } = sqlDouble({
      marked: ['m1'],
      lifted: ['m2', 'm3'],
      closed: ['m4'],
      still: ['m5'],
    });
    await queueSpamVerdictCorpusJobs(sql, ORG, [
      { conversationId: 'marked', from: 'open', to: 'spam' },
      { conversationId: 'lifted', from: 'spam', to: 'open' },
      { conversationId: 'closed', from: 'open', to: 'closed' },
      { conversationId: 'still', from: 'spam', to: 'spam' },
    ]);
    expect(
      addJobInTx.mock.calls.map(([, name, payload]) => [name, payload]),
    ).toEqual([
      ['knowledge.release_refs', { organizationId: ORG, refs: ['msg:m1'] }],
      ['rag.index_message', { messageId: 'm2' }],
      ['rag.index_message', { messageId: 'm3' }],
    ]);
    // The re-index skips an empty body, as the ingest enqueue does.
    expect(reads.map((read) => read.values.at(-1))).toEqual([true, false]);
  });
});
