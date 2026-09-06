// @vitest-environment node

/**
 * The 0.5 usage ledger prices every chat and title turn at booking: the read
 * side (usage metrics, cost budgets, the composer's budget gate) sums the
 * stored column, so a turn booked at 0 is model spend that never existed.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveOrgSlug, resolveProvidersForOrg, getProviderCatalog } =
  vi.hoisted(() => ({
    resolveOrgSlug: vi.fn(),
    resolveProvidersForOrg: vi.fn(),
    getProviderCatalog: vi.fn(),
  }));

vi.mock('../../lib/org-config.ts', () => ({ resolveOrgSlug }));
vi.mock('../../core/lib/providers/org_providers.ts', () => ({
  resolveProvidersForOrg,
}));
vi.mock('../../core/lib/providers/catalog_fetch.ts', () => ({
  getProviderCatalog,
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

import { ThreadBusyError } from '../../../lib/chat/turn.ts';
import {
  createPgTurnStore,
  createPgUsageLedger,
  estimateTurnCostCents,
} from './store.ts';

const OPENROUTER = {
  name: 'openrouter',
  catalog: { source: 'openrouter-api' },
};
const PRICED_CATALOG = [
  {
    id: 'z-ai/glm-5.1',
    pricing: { inputCentsPerMillion: 100, outputCentsPerMillion: 200 },
  },
  { id: 'free/model' },
];

/** A tagged-template `sql` that records every statement's bound values. */
function capturingSql(): { sql: Sql; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const tag = (_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised by the ledger
  return { sql: tag as unknown as Sql, calls };
}

const ENTRY = {
  organizationId: 'org_ledger',
  userId: 'user_1',
  model: 'z-ai/glm-5.1',
  provider: 'openrouter',
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  totalTokens: 1_500_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveOrgSlug.mockResolvedValue('acme');
  resolveProvidersForOrg.mockReturnValue([OPENROUTER]);
  getProviderCatalog.mockResolvedValue(PRICED_CATALOG);
});

describe('estimateTurnCostCents', () => {
  it("prices the turn from the serving connector's catalog pricing", async () => {
    const { sql } = capturingSql();
    // 1M input at 100 c/M + 0.5M output at 200 c/M.
    await expect(estimateTurnCostCents(sql, ENTRY)).resolves.toBe(200);
    expect(resolveProvidersForOrg).toHaveBeenCalledWith('acme');
    expect(getProviderCatalog).toHaveBeenCalledWith(OPENROUTER);
  });

  it('books 0 for a model the catalog does not price, and for an unknown one', async () => {
    const { sql } = capturingSql();
    await expect(
      estimateTurnCostCents(sql, { ...ENTRY, model: 'free/model' }),
    ).resolves.toBe(0);
    await expect(
      estimateTurnCostCents(sql, { ...ENTRY, model: 'nobody/knows' }),
    ).resolves.toBe(0);
  });

  it('books 0 (never throws) when the catalog cannot be resolved', async () => {
    const { sql } = capturingSql();
    getProviderCatalog.mockRejectedValue(new Error('listing offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(estimateTurnCostCents(sql, ENTRY)).resolves.toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createPgUsageLedger', () => {
  it('writes the priced cost into the period buckets, not 0', async () => {
    const { sql, calls } = capturingSql();
    await createPgUsageLedger(sql).record(ENTRY);
    // One usage_events insert + three period-bucket upserts, every bucket
    // carrying the priced cost among its bound values.
    expect(calls.length).toBe(4);
    const buckets = calls.slice(1);
    for (const values of buckets) {
      expect(values).toContain(200);
    }
  });
});

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * A transaction-aware fake `sql`: the pool tag and each `begin` callback's
 * tag log to SEPARATE ledgers, so a test can prove which writes rode the
 * transaction and which bypassed it. Statements are answered by shape — a
 * message insert returns the next row id, the generations claim returns a
 * row unless the fake is told the thread is held.
 */
function fakeChatSql(options: { threadHeld?: boolean } = {}): {
  sql: Sql;
  pool: Statement[];
  tx: Statement[];
  transactions: Array<'commit' | 'rollback'>;
  notified: string[];
} {
  const pool: Statement[] = [];
  const tx: Statement[] = [];
  const transactions: Array<'commit' | 'rollback'> = [];
  const notified: string[] = [];
  let messageRows = 0;
  const answer = (text: string): unknown[] => {
    if (text.includes('INSERT INTO app.messages')) {
      messageRows += 1;
      return [{ id: `msg_${messageRows}`, order: messageRows - 1 }];
    }
    if (text.includes('FROM app.thread_metadata WHERE thread_id')) {
      return [{ branchRootId: null, chatType: 'chat', userId: 'user_1' }];
    }
    if (text.includes('INSERT INTO app.generations')) {
      return options.threadHeld === true ? [] : [{ threadId: 'thread_1' }];
    }
    return [];
  };
  const makeTag = (log: Statement[]) => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      log.push({ text, values });
      return Promise.resolve(answer(text));
    };
    tag.json = (value: unknown) => ({ json: value });
    return tag;
  };
  const pooled = Object.assign(makeTag(pool), {
    notify(channel: string, payload: string) {
      notified.push(`${channel}:${payload}`);
      return Promise.resolve();
    },
    async begin(fn: (tx: unknown) => Promise<unknown>) {
      try {
        const result = await fn(makeTag(tx));
        transactions.push('commit');
        return result;
      } catch (error) {
        transactions.push('rollback');
        throw error;
      }
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the turn store exercises exactly the tag, json, notify, and begin surfaces faked here
  return { sql: pooled as unknown as Sql, pool, tx, transactions, notified };
}

const OPEN = {
  organizationId: 'org_1',
  threadId: 'thread_1',
  userParts: [{ type: 'text' as const, text: 'hello' }],
};

describe('createPgTurnStore.beginTurn', () => {
  it('opens the turn inside ONE transaction and notifies only once it committed', async () => {
    const f = fakeChatSql();
    const opened = await createPgTurnStore(f.sql).beginTurn(OPEN);

    expect(opened.userMessage?.id).toBe('msg_1');
    expect(opened.assistantMessage.id).toBe('msg_2');
    expect(f.transactions).toEqual(['commit']);
    // Every write rode the transaction; nothing touched the pool directly,
    // so no crash between the three can leave a partial open behind.
    expect(f.pool).toEqual([]);
    const texts = f.tx.map((statement) => statement.text);
    expect(
      texts.filter((t) => t.includes('INSERT INTO app.messages')),
    ).toHaveLength(2);
    expect(texts.some((t) => t.includes('INSERT INTO app.generations'))).toBe(
      true,
    );
    expect(
      texts.some((t) => t.includes("generation_status = 'generating'")),
    ).toBe(true);
    expect(f.notified).toEqual(['chat_stream:thread_1']);
  });

  it('claims the thread with DO NOTHING and rolls the whole open back when another turn holds it', async () => {
    const f = fakeChatSql({ threadHeld: true });

    await expect(
      createPgTurnStore(f.sql).beginTurn(OPEN),
    ).rejects.toBeInstanceOf(ThreadBusyError);

    expect(f.transactions).toEqual(['rollback']);
    const claim = f.tx.find((statement) =>
      statement.text.includes('INSERT INTO app.generations'),
    );
    expect(claim?.text).toContain('ON CONFLICT (thread_id) DO NOTHING');
    expect(claim?.text).not.toContain('DO UPDATE');
    // The loser announces nothing — no NOTIFY for a turn that never opened,
    // and no sidecar write claiming the thread is generating.
    expect(f.notified).toEqual([]);
    expect(
      f.tx.some((s) => s.text.includes("generation_status = 'generating'")),
    ).toBe(false);
  });
});

describe('createPgTurnStore.appendMessage', () => {
  it('notifies the thread stream — a refusal lands its rows through this write alone', async () => {
    const f = fakeChatSql();
    const appended = await createPgTurnStore(f.sql).appendMessage({
      organizationId: 'org_1',
      threadId: 'thread_1',
      role: 'assistant',
      parts: [],
      blockedReason: 'The chat_filter guardrail refused this message.',
    });

    expect(appended.id).toBe('msg_1');
    // No generation row ever opens for a pre-model refusal, so without this
    // NOTIFY the other viewers of the thread learn of the two rows only on a
    // later invalidation.
    expect(f.notified).toEqual(['chat_stream:thread_1']);
  });
});

describe('createPgTurnStore.endGeneration', () => {
  it('closes the row, settles the sidecar, and fails a still-pending placeholder in one transaction', async () => {
    const f = fakeChatSql();
    await createPgTurnStore(f.sql).endGeneration({
      organizationId: 'org_1',
      threadId: 'thread_1',
    });

    expect(f.transactions).toEqual(['commit']);
    expect(f.pool).toEqual([]);
    const texts = f.tx.map((statement) => statement.text);
    expect(texts.some((t) => t.includes('DELETE FROM app.generations'))).toBe(
      true,
    );
    expect(texts.some((t) => t.includes("generation_status = 'idle'"))).toBe(
      true,
    );
    expect(
      texts.some(
        (t) =>
          t.includes("status = 'failed'") && t.includes("status = 'pending'"),
      ),
    ).toBe(true);
    expect(f.notified).toEqual(['chat_stream:thread_1']);
  });
});
