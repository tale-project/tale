// @vitest-environment node

/**
 * The MCP endpoint's call counters over a recording fake of the postgres.js
 * tag: what one answered call writes, under whose organization, and that a
 * failed write never fails the call.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MCP_ACTIVITY_RETENTION_DAYS,
  mcpCallLogLine,
  recordMcpActivity,
  sweepMcpActivity,
  utcDay,
} from './activity.ts';
import type { McpCaller } from './caller.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(respond: (statement: Statement) => unknown = () => []): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings
      .reduce(
        (acc, part, index) =>
          `${acc}${part}${index < values.length ? '?' : ''}`,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim();
    const statement = { text, values };
    statements.push(statement);
    try {
      return Promise.resolve(respond(statement));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a recording stand-in for the tag
  return { sql: tag as unknown as Sql, statements };
}

function caller(organizationId: string, apiKeyId?: string): McpCaller {
  return {
    organizationId,
    orgSlug: organizationId,
    userId: 'user_ada',
    role: 'developer',
    credential: {
      kind: 'api-key',
      ...(apiKeyId === undefined ? {} : { apiKeyId }),
    },
  };
}

const NOW = Date.UTC(2026, 9, 8, 23, 59, 30);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordMcpActivity', () => {
  it("counts one call under the caller's organization, person, key, method, tool and UTC day", async () => {
    const fake = fakeSql();
    await recordMcpActivity(
      fake.sql,
      caller('org_a', 'key_laptop'),
      { method: 'tools/call', tool: 'get_run', outcome: 'ok', ms: 12 },
      NOW,
    );
    const insert = fake.statements[0];
    expect(insert?.text).toContain(
      'INSERT INTO app.mcp_client_activity ( org_id, user_id, credential_kind, credential_id, method, tool, day, calls, refusals, failures, client_name, last_at_ms )',
    );
    expect(insert?.text).toContain(
      'ON CONFLICT (org_id, user_id, credential_id, method, tool, day) DO UPDATE SET calls = app.mcp_client_activity.calls + 1',
    );
    expect(insert?.values).toEqual([
      'org_a',
      'user_ada',
      'api-key',
      'key_laptop',
      'tools/call',
      'get_run',
      20261008,
      0,
      0,
      null,
      NOW,
    ]);
  });

  it('counts a refusal and an unexpected failure apart, and keeps the client name an initialize gave', async () => {
    const fake = fakeSql();
    await recordMcpActivity(
      fake.sql,
      caller('org_a', 'key_laptop'),
      {
        method: 'tools/call',
        tool: 'save_automation',
        outcome: 'refused',
        code: 'INVALID_ARGUMENTS',
        ms: 3,
      },
      NOW,
    );
    await recordMcpActivity(
      fake.sql,
      caller('org_a', 'key_laptop'),
      { method: 'tools/call', tool: 'get_run', outcome: 'error', ms: 3 },
      NOW,
    );
    await recordMcpActivity(
      fake.sql,
      caller('org_a', 'key_laptop'),
      {
        method: 'initialize',
        outcome: 'ok',
        ms: 1,
        clientName: 'Claude Code',
      },
      NOW,
    );
    const [refused, failed, initialized] = fake.statements;
    expect(refused?.values.slice(7, 9)).toEqual([1, 0]);
    expect(failed?.values.slice(7, 9)).toEqual([0, 1]);
    expect(initialized?.values[5]).toBe('');
    expect(initialized?.values[9]).toBe('Claude Code');
    // A later call without a name keeps the one the client gave.
    expect(initialized?.text).toContain(
      'client_name = COALESCE( EXCLUDED.client_name, app.mcp_client_activity.client_name )',
    );
  });

  it('keeps every organization’s counters apart: a row is keyed by the caller’s own organization [MCP-R21]', async () => {
    const fake = fakeSql();
    const call = {
      method: 'tools/call' as const,
      tool: 'list_automations',
      outcome: 'ok' as const,
      ms: 1,
    };
    await recordMcpActivity(fake.sql, caller('org_a', 'key_1'), call, NOW);
    await recordMcpActivity(fake.sql, caller('org_b', 'key_1'), call, NOW);
    expect(fake.statements.map((statement) => statement.values[0])).toEqual([
      'org_a',
      'org_b',
    ]);
    // The organization leads the conflict key, so the same key in two
    // organizations never adds to one row.
    expect(fake.statements[0]?.text).toContain(
      'ON CONFLICT (org_id, user_id, credential_id, method, tool, day)',
    );
  });

  it('writes nothing for a credential without an id', async () => {
    const fake = fakeSql();
    await recordMcpActivity(
      fake.sql,
      caller('org_a'),
      { method: 'ping', outcome: 'ok', ms: 1 },
      NOW,
    );
    expect(fake.statements).toEqual([]);
  });

  it('never fails the call when the write fails — it only warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeSql(() => {
      throw new Error('connection reset');
    });
    await expect(
      recordMcpActivity(
        fake.sql,
        caller('org_a', 'key_1'),
        { method: 'tools/list', outcome: 'ok', ms: 1 },
        NOW,
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('mcpCallLogLine', () => {
  it('names who called, with which key, what, how it went and how long it took', () => {
    expect(
      mcpCallLogLine(caller('org_a', 'key_1'), {
        method: 'tools/call',
        tool: 'start_run',
        outcome: 'refused',
        code: 'RATE_LIMITED',
        ms: 41.6,
      }),
    ).toBe(
      '[mcp] org=org_a user=user_ada cred=key_1 method=tools/call tool=start_run outcome=refused code=RATE_LIMITED ms=42',
    );
  });

  it('never prints the client’s own name or a code that is free text', () => {
    const line = mcpCallLogLine(caller('org_a', 'key_1'), {
      method: 'initialize',
      outcome: 'refused',
      code: 'not a code; rm -rf /',
      ms: 1,
      clientName: 'Evil‮client',
    });
    expect(line).toBe(
      '[mcp] org=org_a user=user_ada cred=key_1 method=initialize tool=- outcome=refused code=- ms=1',
    );
  });
});

describe('sweepMcpActivity', () => {
  it(`deletes the days older than ${MCP_ACTIVITY_RETENTION_DAYS}, in every organization`, async () => {
    const fake = fakeSql(() => Object.assign([], { count: 4 }));
    await expect(sweepMcpActivity(fake.sql, NOW)).resolves.toBe(4);
    expect(fake.statements[0]?.text).toBe(
      'DELETE FROM app.mcp_client_activity WHERE day < ?',
    );
    expect(fake.statements[0]?.values).toEqual([20260710]);
  });
});

describe('utcDay', () => {
  it('reads the UTC date, whatever the server’s zone', () => {
    expect(utcDay(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(20260101);
    expect(utcDay(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe(20261231);
  });
});
