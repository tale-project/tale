// @vitest-environment node

/**
 * The `externalConversations` window is the erasure lane for a
 * correspondent's mail: deleting a conversation deletes its message rows by
 * cascade, but the corpus copies of its inbound email bodies
 * (`rag.index_message`, keyed by `msg:` ref) live in the knowledge database,
 * where no cascade reaches. So the sweep releases them through the ref seam
 * BEFORE it deletes, with the doomed conversations excluded from the
 * liveness answer, and keeps any conversation whose release failed — the
 * window must never delete a body while its indexed copy lives on.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { releaseRefs } from '../knowledge/release.ts';
import { sweepOrgPhase2 } from './service.ts';

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
      text.includes('conversation_id IN')
    ) {
      const ids = new Set(flat.slice(1, -2));
      rows = script.messages.filter((m) => ids.has(m.conversationId));
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

describe('sweepOrgPhase2 — the conversation window releases indexed email bodies', () => {
  it('releases the doomed conversations’ inbound email refs before it deletes them', async () => {
    const events: string[] = [];
    releaseRefsMock.mockImplementation(async () => {
      events.push('releaseRefs');
      return { released: [ref('m-1'), ref('m-2')], kept: [], failures: [] };
    });
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
    // Only what the corpus can hold: inbound email.
    expect(messageRead?.values).toEqual([
      'org_1',
      'conv-1',
      'conv-2',
      'inbound',
      'email',
    ]);
    expect(releaseRefsMock).toHaveBeenCalledTimes(1);
    expect(releaseRefsMock).toHaveBeenCalledWith(fake.sql, {
      organizationId: 'org_1',
      orgSlug: 'acme',
      refs: [ref('m-1'), ref('m-2')],
      excludeConversationIds: ['conv-1', 'conv-2'],
    });
    expect(events.indexOf('releaseRefs')).toBeLessThan(
      events.indexOf('DELETE FROM app.conversations'),
    );
    const purge = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.conversations'),
    );
    expect(purge?.values).toEqual(['conv-1', 'conv-2']);
  });

  it('keeps a conversation whose email release failed, and purges the rest', async () => {
    releaseRefsMock.mockResolvedValue({
      released: [ref('m-2')],
      kept: [],
      failures: [{ ref: ref('m-1'), stage: 'corpus', message: 'corpus down' }],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeSweep({
      doomed: ['conv-1', 'conv-2'],
      messages: [
        { id: 'm-1', conversationId: 'conv-1' },
        { id: 'm-2', conversationId: 'conv-2' },
      ],
      events: [],
    });

    const stats = await sweepOrgPhase2(fake.sql, org, holds);

    expect(stats.externalConversations).toBe(1);
    const purge = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.conversations'),
    );
    expect(purge?.values).toEqual(['conv-2']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('purges without a release when no inbound email was indexed', async () => {
    const fake = fakeSweep({ doomed: ['conv-1'], messages: [], events: [] });

    const stats = await sweepOrgPhase2(fake.sql, org, holds);

    expect(stats.externalConversations).toBe(1);
    expect(releaseRefsMock).not.toHaveBeenCalled();
  });
});
