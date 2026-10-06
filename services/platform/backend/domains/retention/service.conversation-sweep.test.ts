// @vitest-environment node

/**
 * The `externalConversations` window is the erasure lane for a
 * correspondent's mail: deleting a conversation deletes its message rows by
 * cascade, but the corpus copies of its inbound email bodies
 * (`rag.index_message`, keyed by `msg:` ref) live in the knowledge database,
 * where no cascade reaches. So the sweep queues their release in the
 * transaction that deletes the conversations — as `deleteConversation`
 * does: the job runs once the rows are gone, pg-boss retries it and the
 * corpus reconcile finishes it, so an unreachable knowledge database never
 * holds the window back, and a body a late job indexed is released too.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { addJobInTx } = vi.hoisted(() => ({
  addJobInTx: vi.fn(
    async (_tx: unknown, _name: string, _payload: unknown) => 'job-1',
  ),
}));

import { releaseRefs } from '../knowledge/release.ts';
import { sweepOrgPhase2 } from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(() => Promise.resolve(null)),
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../knowledge/release.ts', () => ({
  releaseRefs: vi.fn(() =>
    Promise.resolve({ released: [], kept: [], failures: [] }),
  ),
}));
vi.mock('../legal_holds/service.ts', () => ({ loadActiveHolds: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../tts/service.ts', () => ({ cascadeDeleteThreadTtsChunks: vi.fn() }));

const releaseRefsMock = vi.mocked(releaseRefs);

interface Statement {
  text: string;
  values: unknown[];
}

const FRAGMENT = Symbol('fragment');

interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/**
 * A recorder in postgres.js's shape: a tagged template that inlines nested
 * fragments, plus `sql(list)` — the IN-list helper the sweep uses — which it
 * renders as `(?, ?)`. Answers the conversation sweep's reads from the
 * script; the `events` log interleaves statements with release calls, so
 * the tests can read the ORDER as well as the arguments.
 */
function fakeSweep(script: {
  doomed: string[];
  messages: { id: string; conversationId: string }[];
  attachments?: { id: string; storageRef: string; conversationId: string }[];
  events: string[];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fragment = (text: string, values: unknown[]): Fragment => ({
    [FRAGMENT]: true,
    text,
    values,
  });
  const tag = (
    first: TemplateStringsArray | readonly unknown[],
    ...values: unknown[]
  ): unknown => {
    if (!('raw' in first)) {
      return fragment(`(${first.map(() => '?').join(', ')})`, [...first]);
    }
    let text = '';
    const flat: unknown[] = [];
    first.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    script.events.push(text.split(' ').slice(0, 3).join(' '));
    let rows: unknown[] = [];
    if (text.startsWith('SELECT id FROM app.conversations')) {
      rows = script.doomed.map((id) => ({ id }));
    } else if (
      text.includes('FROM app.conversation_messages') &&
      text.includes('conversation_id = ANY')
    ) {
      const ids = new Set(flat[1] as string[]);
      rows = script.messages.filter((m) => ids.has(m.conversationId));
    } else if (text.includes('FROM app.file_metadata')) {
      rows = script.attachments ?? [];
    } else if (text.startsWith('DELETE FROM app.conversations')) {
      rows = flat.map((id) => ({ id }));
    }
    return Object.assign(Promise.resolve(rows), fragment(text, flat));
  };
  tag.begin = (callback: (tx: typeof tag) => unknown): unknown => callback(tag);
  tag.unsafe = (text: string): Fragment => fragment(text, []);
  tag.json = (value: unknown): unknown => value;
  return { sql: tag as unknown as Sql, statements };
}

const org = {
  organizationId: 'org_1',
  config: {
    externalConversationsEnabled: true,
    externalConversationsRetentionDays: 30,
    deletionGraceDays: 0,
  },
};
const holds = { orgHeld: false, userMembershipIds: new Set<string>() };
const ref = (id: string) => `msg:${id}`;

afterEach(() => {
  vi.clearAllMocks();
});

describe('sweepOrgPhase2 — the conversation window releases indexed email bodies [RETAIN-R8]', () => {
  function recordEnqueues(events: string[]): void {
    addJobInTx.mockImplementation(async (_tx: unknown, name: string) => {
      events.push(`enqueue ${name}`);
      return 'job-1';
    });
  }

  it('queues the release of the purged conversations’ email refs in the delete’s transaction', async () => {
    const events: string[] = [];
    recordEnqueues(events);
    const fake = fakeSweep({
      doomed: ['conv-1', 'conv-2'],
      messages: [
        { id: 'm-1', conversationId: 'conv-1' },
        { id: 'm-2', conversationId: 'conv-2' },
      ],
      events,
    });

    const stats = await sweepOrgPhase2(fake.sql, org, holds);

    expect(stats.externalConversations).toBe(2);
    const messageRead = fake.statements.find((s) =>
      s.text.includes('FROM app.conversation_messages'),
    );
    // Only what the corpus can hold: inbound email a connector delivered.
    expect(messageRead?.values.slice(0, 4)).toEqual([
      'org_1',
      ['conv-1', 'conv-2'],
      'inbound',
      'email',
    ]);
    expect(messageRead?.text).toContain("connector_name <> ''");
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'knowledge.release_refs',
      { organizationId: 'org_1', refs: [ref('m-1'), ref('m-2')] },
    );
    // Read before the rows go, queued after them: the job runs once the
    // transaction commits and finds the refs dead.
    expect(fake.statements.indexOf(messageRead as Statement)).toBeLessThan(
      fake.statements.findIndex((s) =>
        s.text.startsWith('DELETE FROM app.conversations'),
      ),
    );
    expect(events.indexOf('enqueue knowledge.release_refs')).toBeGreaterThan(
      events.indexOf('DELETE FROM app.conversations'),
    );
    // The knowledge database is never asked while the window runs, so one
    // that cannot be reached strands nothing.
    expect(releaseRefsMock).not.toHaveBeenCalled();
    const purge = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.conversations'),
    );
    expect(purge?.values).toEqual(['conv-1', 'conv-2']);
  });

  it('releases no body of a conversation kept for its attachment', async () => {
    // An attachment whose bytes could not be released keeps its
    // conversation — and the conversation keeps its messages, so their
    // corpus copies stay with them for the next sweep.
    releaseRefsMock.mockResolvedValue({
      released: [],
      kept: [],
      failures: [{ ref: 's3:a', stage: 'blob', message: 'store down' }],
    });
    recordEnqueues([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeSweep({
      doomed: ['conv-1', 'conv-2'],
      messages: [
        { id: 'm-1', conversationId: 'conv-1' },
        { id: 'm-2', conversationId: 'conv-2' },
      ],
      attachments: [
        { id: 'f-1', storageRef: 's3:a', conversationId: 'conv-1' },
      ],
      events: [],
    });

    const stats = await sweepOrgPhase2(fake.sql, org, holds);

    expect(stats.externalConversations).toBe(1);
    const purge = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.conversations'),
    );
    expect(purge?.values).toEqual(['conv-2']);
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'knowledge.release_refs',
      { organizationId: 'org_1', refs: [ref('m-2')] },
    );
    warn.mockRestore();
  });

  it('releases each purged conversation’s emailed attachment with its own row excluded, then deletes the row', async () => {
    // The attachments' corpus copies — and their bytes, when nothing else
    // holds them — go before the conversation does: the release reads the
    // attachment's own file row as gone (`excludeFileMetadataId`), so the
    // corpus copy is dead whatever the conversation still says.
    releaseRefsMock.mockResolvedValue({
      released: ['s3:a'],
      kept: [],
      failures: [],
    });
    const events: string[] = [];
    recordEnqueues(events);
    const fake = fakeSweep({
      doomed: ['conv-1'],
      messages: [{ id: 'm-1', conversationId: 'conv-1' }],
      attachments: [
        { id: 'f-1', storageRef: 's3:a', conversationId: 'conv-1' },
      ],
      events,
    });

    const stats = await sweepOrgPhase2(fake.sql, org, holds);

    expect(stats.externalConversations).toBe(2);
    expect(releaseRefsMock).toHaveBeenCalledWith(fake.sql, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      refs: ['s3:a'],
      excludeFileMetadataId: 'f-1',
    });
    const rowDelete = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.file_metadata'),
    );
    expect(rowDelete?.values).toEqual(['f-1']);
    // Before the conversation goes, and never queued again: the bodies'
    // refs are the job's whole payload.
    expect(fake.statements.indexOf(rowDelete as Statement)).toBeLessThan(
      fake.statements.findIndex((s) =>
        s.text.startsWith('DELETE FROM app.conversations'),
      ),
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'knowledge.release_refs',
      { organizationId: 'org_1', refs: [ref('m-1')] },
    );
  });

  it('purges without a release when no inbound email was indexed', async () => {
    const fake = fakeSweep({ doomed: ['conv-1'], messages: [], events: [] });

    const stats = await sweepOrgPhase2(fake.sql, org, holds);

    expect(stats.externalConversations).toBe(1);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
