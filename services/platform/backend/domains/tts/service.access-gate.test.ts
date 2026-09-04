/**
 * The two TTS doors that used to diverge from the thread-ownership gate:
 * synthesis accepted any messageId under the caller's own thread (a squatter
 * could mint the global `(message_id, chunk_index)` reservation for someone
 * else's message), and the audio serve checked org membership only. Both now
 * go through the same `loadOwnedThread` rule as the listing and usage doors.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { getChunkForServe, synthesizeChunk, TtsError } from './service.ts';

type Answer = (text: string, values: unknown[]) => unknown[];

/** A `sql` stand-in dispatching on the query text; `begin` runs the callback
 * against the same stand-in so audit writes inside a transaction are seen. */
function fakeSql(answer: Answer, log: { text: string; values: unknown[] }[]) {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const api = {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  };
  const sql = Object.assign(tag, api);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

const ORG = 'org-1';
const OWNER = 'user-owner';
const STRANGER = 'user-stranger';
const THREAD = 'thr-1';

/** Answers the thread-ownership read for `owner` only, the message-in-thread
 * read per `messageInThread`, and the audit chain writes. */
function answers(opts: { owner: string; messageInThread: boolean }): Answer {
  return (text, values) => {
    if (text.includes('FROM app.threads t')) {
      return values.includes(opts.owner) ? [{ id: THREAD }] : [];
    }
    if (text.includes('FROM app.messages')) {
      return opts.messageInThread ? [{ one: 1 }] : [];
    }
    if (text.includes('FROM app.audit_chain_heads')) {
      return [{ lastHash: '', lastTs: 0 }];
    }
    if (text.includes('INSERT INTO app.audit_logs')) {
      return [{ id: 'audit-1' }];
    }
    if (text.includes('FROM app.tts_audio_chunks')) {
      return [
        {
          threadId: THREAD,
          storageRef: 's3:org-1/chunk',
          status: 'ready',
          format: 'mp3',
        },
      ];
    }
    return [];
  };
}

describe('synthesizeChunk — the message must belong to the thread', () => {
  it('refuses a messageId that is not a row of the (owned) thread, and audits it', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    const sql = fakeSql(answers({ owner: OWNER, messageInThread: false }), log);

    const outcome = await synthesizeChunk(sql, {
      organizationId: ORG,
      userId: OWNER,
      messageId: 'msg-from-someone-elses-thread',
      threadId: THREAD,
      index: 0,
      text: 'Hello.',
      locale: 'en',
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(outcome).toBeInstanceOf(TtsError);
    if (outcome instanceof TtsError) {
      expect(outcome.code).toBe('FORBIDDEN');
      expect(outcome.status).toBe(403);
    }
    const audit = log.find((q) =>
      q.text.includes('INSERT INTO app.audit_logs'),
    );
    expect(audit?.values).toContain('tts.synthesize_denied');
    expect(JSON.stringify(audit?.values)).toContain('message_not_in_thread');
    // Refused BEFORE the model resolve / reservation: no chunk row is ever
    // minted under the squatter's thread.
    expect(log.some((q) => q.text.includes('FROM app.thread_metadata'))).toBe(
      false,
    );
    expect(
      log.some((q) => q.text.includes('INSERT INTO app.tts_audio_chunks')),
    ).toBe(false);
  });

  it('lets a message of the owned thread through the gate', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    const sql = fakeSql(answers({ owner: OWNER, messageInThread: true }), log);

    const outcome = await synthesizeChunk(sql, {
      organizationId: ORG,
      userId: OWNER,
      messageId: 'msg-1',
      threadId: THREAD,
      index: 0,
      text: 'Hello.',
      locale: 'en',
    }).then(
      () => null,
      (err: unknown) => err,
    );

    // Whatever the (unfaked) model resolver does afterwards, the gate itself
    // passed: the next read is the thread's agent binding.
    expect(outcome instanceof TtsError && outcome.code === 'FORBIDDEN').toBe(
      false,
    );
    expect(log.some((q) => q.text.includes('FROM app.thread_metadata'))).toBe(
      true,
    );
  });
});

describe('getChunkForServe — ownership gate, not org membership', () => {
  it('serves a ready chunk to the owner of its thread', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    const sql = fakeSql(answers({ owner: OWNER, messageInThread: true }), log);
    expect(
      await getChunkForServe(sql, {
        organizationId: ORG,
        userId: OWNER,
        chunkId: 'chunk-1',
      }),
    ).toEqual({ storageRef: 's3:org-1/chunk', contentType: 'audio/mpeg' });
  });

  it('answers null to another member of the org who holds the chunk id', async () => {
    const log: { text: string; values: unknown[] }[] = [];
    const sql = fakeSql(answers({ owner: OWNER, messageInThread: true }), log);
    expect(
      await getChunkForServe(sql, {
        organizationId: ORG,
        userId: STRANGER,
        chunkId: 'chunk-1',
      }),
    ).toBeNull();
    // The gate consulted is the shared thread-ownership read.
    expect(log.some((q) => q.text.includes('FROM app.threads t'))).toBe(true);
  });
});
