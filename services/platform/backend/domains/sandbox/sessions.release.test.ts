// @vitest-environment node

/**
 * Unit lock for the project-agent slot release — the most frequent release
 * edge in the system (every finished turn). The regression under test: the
 * release flipped the standing session to `stopped` (freeing the slot) and
 * returned, so with N parked runs an org drained one run per 2-minute
 * watchdog tick while slots sat idle. The release now wakes the org's
 * oldest parked run itself; the SQL guards (sibling running op, pinned)
 * are proven on the real schema by `integration-check.ts`.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { releaseProjectAgentSessionSlot } from './sessions.ts';

vi.mock('../tasks/agent-runs.ts', () => ({
  wakeParkedAgentRuns: vi.fn(() => Promise.resolve(1)),
}));
vi.mock('./gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(() => Promise.resolve()),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** A scripted `sql`: answers every statement with `rows` and records it. */
function fakeSql(rows: unknown[]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: fn as unknown as Sql, statements };
}

const ARGS = { organizationId: 'org-1', agentId: 'agent-1' };

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('releaseProjectAgentSessionSlot', () => {
  it('hibernates the owner-keyed session behind the running-op and pinned guards', async () => {
    const { sql, statements } = fakeSql([{ id: 'row-1' }]);

    const released = await releaseProjectAgentSessionSlot(sql, ARGS);

    expect(released).toBe(true);
    const update = statements[0];
    expect(update?.text).toContain(
      "UPDATE app.sandbox_sessions s SET status = 'stopped'",
    );
    expect(update?.text).toContain("s.owner_type = 'project_agent'");
    expect(update?.text).toContain(
      "s.status IN ('creating', 'active', 'degraded')",
    );
    expect(update?.text).toContain('s.pinned = false');
    expect(update?.text).toContain("op.status = 'running'");
    expect(update?.values).toEqual(['agent-1', 'org-1']);
  });

  it('wakes the org on the release edge when a slot was freed', async () => {
    const { sql } = fakeSql([{ id: 'row-1' }]);

    await releaseProjectAgentSessionSlot(sql, ARGS);

    expect(wakeParkedAgentRuns).toHaveBeenCalledTimes(1);
    expect(wakeParkedAgentRuns).toHaveBeenCalledWith(sql, 'org-1');
  });

  it('wakes nobody when nothing was freed (sibling turn live, pinned, or already stopped)', async () => {
    const { sql } = fakeSql([]);

    const released = await releaseProjectAgentSessionSlot(sql, ARGS);

    expect(released).toBe(false);
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
  });

  it('never fails the release over a failed wake', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(wakeParkedAgentRuns).mockRejectedValueOnce(
      new Error('boss down'),
    );
    const { sql } = fakeSql([{ id: 'row-1' }]);

    await expect(releaseProjectAgentSessionSlot(sql, ARGS)).resolves.toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[sandbox] capacity wake failed:',
      expect.any(Error),
    );
  });
});
