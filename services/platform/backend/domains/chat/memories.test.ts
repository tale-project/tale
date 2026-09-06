// @vitest-environment node

/**
 * The memories feature gate and the bounded reads, on a fake `sql`: the
 * person's preference beats the org policy default, and with neither set
 * the feature is OFF — a proposal is refused, retrieval answers nothing.
 * The real-Postgres pass rides `integration-check.ts`.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMyPreferences, readGovernancePolicyForOrg, createAuditLog } =
  vi.hoisted(() => ({
    getMyPreferences: vi.fn(),
    readGovernancePolicyForOrg: vi.fn(),
    createAuditLog: vi.fn(),
  }));

vi.mock('../user_preferences/service.ts', () => ({ getMyPreferences }));
vi.mock('../../lib/org-config.ts', () => ({ readGovernancePolicyForOrg }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import {
  deleteMemory,
  isMemoriesEnabled,
  saveMemory,
  searchApprovedMemories,
} from './memories.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    return Promise.resolve(answer({ text, values }) ?? []);
  };
  const pooled = Object.assign(tag, {
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the memories lane exercises exactly the tag and begin surfaces faked here
  return { sql: pooled as unknown as Sql, statements };
}

const SCOPE = { organizationId: 'org_1', userId: 'user_1' };

beforeEach(() => {
  vi.clearAllMocks();
  getMyPreferences.mockResolvedValue(null);
  readGovernancePolicyForOrg.mockResolvedValue(null);
  createAuditLog.mockResolvedValue(undefined);
});

describe('isMemoriesEnabled', () => {
  it('is OFF with neither a preference nor a policy row', async () => {
    const { sql } = fakeSql(() => []);
    await expect(isMemoriesEnabled(sql, SCOPE)).resolves.toBe(false);
  });

  it('follows the org policy default when the person has not chosen', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({ enabled: true });
    const { sql } = fakeSql(() => []);
    await expect(isMemoriesEnabled(sql, SCOPE)).resolves.toBe(true);
    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      sql,
      'org_1',
      'user_memories',
    );
  });

  it("lets the person's explicit choice override the policy either way", async () => {
    readGovernancePolicyForOrg.mockResolvedValue({ enabled: true });
    getMyPreferences.mockResolvedValue({ memoriesEnabled: false });
    const { sql } = fakeSql(() => []);
    await expect(isMemoriesEnabled(sql, SCOPE)).resolves.toBe(false);

    readGovernancePolicyForOrg.mockResolvedValue({ enabled: false });
    getMyPreferences.mockResolvedValue({ memoriesEnabled: true });
    await expect(isMemoriesEnabled(sql, SCOPE)).resolves.toBe(true);
  });
});

describe('saveMemory', () => {
  it('refuses a proposal while the feature is off and writes nothing', async () => {
    const { sql, statements } = fakeSql(() => []);

    await expect(
      saveMemory(sql, { ...SCOPE, content: 'Prefers metric units' }),
    ).rejects.toMatchObject({ code: 'MEMORIES_DISABLED', status: 403 });
    expect(
      statements.some((s) => s.text.includes('INSERT INTO app.memories')),
    ).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('lands the proposal pending, with its audit line, while the feature is on', async () => {
    getMyPreferences.mockResolvedValue({ memoriesEnabled: true });
    const { sql, statements } = fakeSql(({ text }) =>
      text.includes('INSERT INTO app.memories') ? [{ id: 'mem_1' }] : [],
    );

    await expect(
      saveMemory(sql, { ...SCOPE, content: '  Prefers metric units ' }),
    ).resolves.toBe('mem_1');
    const insert = statements.find((s) =>
      s.text.includes('INSERT INTO app.memories'),
    );
    expect(insert?.values.slice(0, 3)).toEqual([
      'org_1',
      'user_1',
      'Prefers metric units',
    ]);
    expect(insert?.text).toContain("'pending'");
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'memory.save', resourceId: 'mem_1' }),
    );
  });
});

describe('searchApprovedMemories', () => {
  it('answers nothing while the feature is off, without touching the table', async () => {
    const { sql, statements } = fakeSql(() => [
      { id: 'mem_1', content: 'Prefers metric units', status: 'approved' },
    ]);

    await expect(
      searchApprovedMemories(sql, { ...SCOPE, query: 'metric' }),
    ).resolves.toEqual([]);
    expect(statements).toHaveLength(0);
  });

  it('pushes the approved-only filter, the query and a bounded limit into the statement', async () => {
    getMyPreferences.mockResolvedValue({ memoriesEnabled: true });
    const { sql, statements } = fakeSql(() => []);

    await searchApprovedMemories(sql, {
      ...SCOPE,
      query: 'me_tric%',
      limit: 500,
    });
    const select = statements[0];
    expect(select?.text).toContain("status = 'approved'");
    expect(select?.text).toContain('ILIKE');
    expect(select?.text).toContain('LIMIT');
    // The query matches as literal text (LIKE metacharacters escaped) and
    // the limit is capped at the retrieval ceiling.
    expect(select?.values).toContain('%me\\_tric\\%%');
    expect(select?.values.at(-1)).toBe(50);
  });

  it('binds no pattern for an empty query and the default limit', async () => {
    getMyPreferences.mockResolvedValue({ memoriesEnabled: true });
    const { sql, statements } = fakeSql(() => []);

    await searchApprovedMemories(sql, { ...SCOPE, query: '  ' });
    expect(statements[0]?.values).toContain(null);
    expect(statements[0]?.values.at(-1)).toBe(20);
  });
});

describe('deleteMemory', () => {
  it("deletes only the caller's own row and reports whether one went", async () => {
    const { sql, statements } = fakeSql(({ values }) =>
      values.includes('mem_mine') ? [{ id: 'mem_mine' }] : [],
    );

    await expect(
      deleteMemory(sql, { ...SCOPE, memoryId: 'mem_mine' }),
    ).resolves.toBe(true);
    await expect(
      deleteMemory(sql, { ...SCOPE, memoryId: 'mem_theirs' }),
    ).resolves.toBe(false);
    for (const statement of statements) {
      expect(statement.text).toContain('DELETE FROM app.memories');
      expect(statement.values.slice(1)).toEqual(['org_1', 'user_1']);
    }
  });
});
