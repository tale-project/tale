// @vitest-environment node

/**
 * A thread's opening user message queues the AI title that names it, once.
 * A model comparison's hidden column is never named on its own: it takes the
 * title its visible partner is given (`setThreadTitleIfAbsent`), so its
 * opening message queues nothing — a second title would be paid for and
 * never read.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/org-config.ts', () => ({ resolveOrgSlug: vi.fn() }));
vi.mock('../../core/lib/providers/org_providers.ts', () => ({
  resolveProvidersForOrg: vi.fn(),
}));
vi.mock('../../core/lib/providers/catalog_fetch.ts', () => ({
  getProviderCatalog: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

import { addJobInTx } from '../../jobs/enqueue.ts';
import { appendMessageRow } from './store.ts';

/** A `sql` for an untitled thread whose comparison role is `arenaRole`. */
function untitledThread(arenaRole: 'a' | 'b' | null): Sql {
  const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?');
    if (text.includes('INSERT INTO app.messages')) {
      return Promise.resolve([{ id: 'm-1', order: 0 }]);
    }
    if (text.includes('FROM app.thread_metadata')) {
      return Promise.resolve([
        {
          branchRootId: null,
          chatType: 'direct',
          userId: 'u-1',
          arenaRole,
        },
      ]);
    }
    if (text.includes('title IS NULL')) {
      return Promise.resolve([{ id: 't-1' }]);
    }
    return Promise.resolve([]);
  };
  Object.assign(tag, { json: (value: unknown) => value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `json` are exercised
  return tag as unknown as Sql;
}

const OPENING = {
  organizationId: 'org-1',
  threadId: 't-1',
  role: 'user',
  parts: [{ type: 'text', text: 'Plan the launch' }],
  text: 'Plan the launch',
  status: 'complete',
};

beforeEach(() => {
  vi.mocked(addJobInTx).mockClear();
});

describe('appendMessageRow — naming a new conversation', () => {
  it.each([
    ['a plain chat', null],
    ['the visible column of a comparison', 'a'],
  ] as const)('queues one title for %s', async (_label, arenaRole) => {
    await appendMessageRow(untitledThread(arenaRole), OPENING);

    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'chat.generate_title',
      expect.objectContaining({
        threadId: 't-1',
        firstMessage: 'Plan the launch',
      }),
    );
  });

  it('queues none for the hidden column, which its partner’s title names', async () => {
    await appendMessageRow(untitledThread('b'), OPENING);

    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
