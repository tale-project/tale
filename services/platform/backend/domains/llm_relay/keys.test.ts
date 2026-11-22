import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readVirtualKeySpend,
  revokeVirtualKey,
  setVirtualKeyBudget,
} from '../../core/node_only/sandbox/llm_gateway_admin.ts';
import { readTurnKeySpend, revokeTurnKey, setTurnKeyBudget } from './keys.ts';

vi.mock('../../core/node_only/sandbox/llm_gateway_admin.ts', () => ({
  readVirtualKeySpend: vi.fn(async () => ({ status: 'ok', cents: 12 })),
  revokeVirtualKey: vi.fn(async () => undefined),
  setVirtualKeyBudget: vi.fn(async () => 'ok'),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** A Sql that records each statement and answers it with `rows`. */
function recordingSql(rows: unknown[]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    statements.push({ text: strings.join('?'), values });
    return rows;
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/** A turn's key, whichever server serves it (tale-project/tale#4942). */
describe('a turn key the model relay serves', () => {
  it('reads its spend off the op that carries it', async () => {
    const { sql, statements } = recordingSql([{ cents: 3.25 }]);

    await expect(readTurnKeySpend(sql, 'tr_1')).resolves.toEqual({
      status: 'ok',
      cents: 3.25,
    });
    expect(statements[0]?.text).toContain('relay_spent_cents');
    expect(statements[0]?.values).toEqual(['tr_1']);
    expect(readVirtualKeySpend).not.toHaveBeenCalled();
  });

  it('reads as gone once no op carries it', async () => {
    const { sql } = recordingSql([]);

    await expect(readTurnKeySpend(sql, 'tr_gone')).resolves.toEqual({
      status: 'gone',
    });
  });

  it('is revoked by revoking its live tokens, never at the gateway', async () => {
    const { sql, statements } = recordingSql([]);

    await revokeTurnKey(sql, 'tr_1');

    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain('UPDATE app.sandbox_session_tokens');
    expect(statements[0]?.text).toContain('revoked_at_ms IS NULL');
    expect(statements[0]?.values).toContain('tr_1');
    expect(revokeVirtualKey).not.toHaveBeenCalled();
  });

  it('has no cap to move: the relay weighs the turn at every call', async () => {
    await expect(setTurnKeyBudget('tr_1', 40)).resolves.toBe('ok');
    expect(setVirtualKeyBudget).not.toHaveBeenCalled();
  });
});

describe('a turn key the sandbox LLM gateway minted', () => {
  it('still settles at the gateway', async () => {
    const { sql, statements } = recordingSql([]);

    await expect(readTurnKeySpend(sql, 'vk-1')).resolves.toEqual({
      status: 'ok',
      cents: 12,
    });
    await revokeTurnKey(sql, 'vk-1');
    await expect(setTurnKeyBudget('vk-1', 40)).resolves.toBe('ok');

    expect(readVirtualKeySpend).toHaveBeenCalledWith('vk-1');
    expect(revokeVirtualKey).toHaveBeenCalledWith('vk-1');
    expect(setVirtualKeyBudget).toHaveBeenCalledWith('vk-1', 40);
    expect(statements).toHaveLength(0);
  });
});
