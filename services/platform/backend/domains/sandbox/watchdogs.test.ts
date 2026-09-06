// @vitest-environment node

/**
 * Unit lock for the sandbox sweep's spawner-facing passes: the reconcile
 * batch is a FAIR walk (least-recently-visited first, every visited row
 * stamped — not the 25 globally-oldest rows forever), and the ended-run
 * reclaim settles a row only when the spawner confirmed the session is gone
 * or idle (busy and errors leave it for the next tick). The real-Postgres
 * probe (`integration-check.ts`) proves the rotation and the reclaim guards
 * on the actual schema.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileSession } from './service.ts';
import { markSessionDestroyed } from './sessions.ts';
import {
  runSandboxWatchdog,
  SANDBOX_RUN_SESSION_RECLAIM_GRACE_MS,
  type WatchdogSpawner,
} from './watchdogs.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sessionIsAlive: vi.fn(),
  sessionDestroyIfIdle: vi.fn(),
}));
vi.mock('../tasks/agent-runs.ts', () => ({
  wakeParkedAgentRuns: vi.fn(() => Promise.resolve()),
}));
vi.mock('./service.ts', () => ({ reconcileSession: vi.fn() }));
vi.mock('./sessions.ts', () => ({
  markSessionDestroyed: vi.fn(() => Promise.resolve(true)),
}));

interface Statement {
  text: string;
  values: unknown[];
}

interface Candidate {
  id: string;
  sessionId: string;
  orgId: string;
}

/**
 * Scripted `sql`: the reconcile SELECT and the reclaim SELECT pop from their
 * scripts; the EXPIRE update and the visit stamps answer with no rows. Every
 * statement is recorded for shape assertions.
 */
function fakeSql(script: {
  reconcile?: Candidate[][];
  reclaim?: Candidate[][];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes("s.owner_type = 'workflow_run'")) {
      return Promise.resolve(script.reclaim?.shift() ?? []);
    }
    if (
      text.includes('SELECT id, session_id') &&
      text.includes("WHERE status IN ('creating', 'active', 'degraded')")
    ) {
      return Promise.resolve(script.reconcile?.shift() ?? []);
    }
    return Promise.resolve([]);
  };
  return { sql: fn as unknown as Sql, statements };
}

function candidate(id: string): Candidate {
  return { id, sessionId: `ses-${id}`, orgId: 'org_1' };
}

const stampsOf = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes('SET last_reconciled_at_ms'));

beforeEach(() => {
  vi.mocked(reconcileSession).mockResolvedValue('live');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runSandboxWatchdog — fair reconcile', () => {
  it('walks least-recently-visited first, probes with the injected spawner, and stamps every visited row', async () => {
    const batch = [candidate('a'), candidate('b'), candidate('c')];
    const { sql, statements } = fakeSql({ reconcile: [batch] });
    const spawner: WatchdogSpawner = {
      isAlive: vi.fn(() => Promise.resolve(true)),
      destroyIfIdle: vi.fn(() =>
        Promise.resolve({ destroyed: false, busy: false }),
      ),
    };
    vi.mocked(reconcileSession).mockResolvedValueOnce('healed');

    const result = await runSandboxWatchdog(sql, {
      reconcileBatch: 3,
      spawner,
    });

    expect(result).toMatchObject({ healed: 1, reclaimed: 0 });
    const select = statements.find(
      (s) =>
        s.text.includes('SELECT id, session_id') &&
        s.text.includes("WHERE status IN ('creating', 'active', 'degraded')"),
    );
    // The rotation: never-visited rows first, then the stalest visit — NOT
    // `ORDER BY created_at_ms`, which parked the same 25 oldest rows at the
    // head of every tick.
    expect(select?.text).toContain(
      'ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC',
    );
    expect(select?.values).toContain(3);

    // Each candidate probed through the injected liveness verb.
    expect(reconcileSession).toHaveBeenCalledTimes(3);
    for (const row of batch) {
      expect(reconcileSession).toHaveBeenCalledWith(
        sql,
        { organizationId: row.orgId, sessionId: row.sessionId },
        { isAlive: spawner.isAlive },
      );
    }

    // Every visited row is stamped in one statement, by primary key.
    const stamps = stampsOf(statements);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.values).toContainEqual(['a', 'b', 'c']);
  });

  it('stamps a row whose probe failed too, so a persistently erroring row cannot block the rotation', async () => {
    const { sql, statements } = fakeSql({
      reconcile: [[candidate('x'), candidate('y')]],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(reconcileSession).mockRejectedValueOnce(
      new Error('spawner unreachable'),
    );

    const result = await runSandboxWatchdog(sql, {
      reconcileBatch: 2,
      spawner: {
        isAlive: vi.fn(() => Promise.resolve(true)),
        destroyIfIdle: vi.fn(() =>
          Promise.resolve({ destroyed: false, busy: false }),
        ),
      },
    });

    expect(result.healed).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(stampsOf(statements)[0]?.values).toContainEqual(['x', 'y']);
  });
});

describe('runSandboxWatchdog — reclaim of ended runs', () => {
  it('settles the row only when the spawner destroyed (or lacked) the session; busy and errors wait for the next tick', async () => {
    const ended = candidate('ended');
    const busy = candidate('busy');
    const broken = candidate('broken');
    const { sql, statements } = fakeSql({ reclaim: [[ended, busy, broken]] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const destroyIfIdle = vi.fn((sessionId: string) => {
      if (sessionId === busy.sessionId) {
        return Promise.resolve({ destroyed: false, busy: true });
      }
      if (sessionId === broken.sessionId) {
        return Promise.reject(new Error('spawner 502'));
      }
      return Promise.resolve({ destroyed: true, busy: false });
    });

    const result = await runSandboxWatchdog(sql, {
      spawner: { isAlive: vi.fn(() => Promise.resolve(true)), destroyIfIdle },
    });

    expect(result.reclaimed).toBe(1);
    expect(destroyIfIdle).toHaveBeenCalledTimes(3);
    // Only the confirmed-gone session's row settled.
    expect(markSessionDestroyed).toHaveBeenCalledTimes(1);
    expect(markSessionDestroyed).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      sessionId: ended.sessionId,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('reclaim destroy failed'),
      expect.any(Error),
    );
    // All three were visited: stamped so the rotation moves on.
    const stamps = stampsOf(statements);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.values).toContainEqual(['ended', 'busy', 'broken']);
  });

  it('targets only hibernated/expired workflow_run rows of TERMINAL (or purged) runs past the grace', async () => {
    const { sql, statements } = fakeSql({});
    const before = Date.now();

    await runSandboxWatchdog(sql, {
      spawner: {
        isAlive: vi.fn(() => Promise.resolve(true)),
        destroyIfIdle: vi.fn(() =>
          Promise.resolve({ destroyed: true, busy: false }),
        ),
      },
    });

    const select = statements.find((s) =>
      s.text.includes("s.owner_type = 'workflow_run'"),
    );
    expect(select).toBeDefined();
    // Never a compute-holding row.
    expect(select?.text).toContain("s.status IN ('stopped', 'expired')");
    // Only a run that can never resume its session.
    expect(select?.text).toContain(
      "r.status IN ('success', 'failed', 'cancelled')",
    );
    // A purged run (retention) leaves an orphan row — reclaimed by its age.
    expect(select?.text).toContain('r.id IS NULL AND s.created_at_ms <');
    // The grace horizon is now - grace (two ticks), bound as a value.
    const horizons = (select?.values ?? []).filter(
      (v): v is number => typeof v === 'number' && v > 1_000_000_000_000,
    );
    expect(horizons.length).toBeGreaterThan(0);
    for (const horizon of horizons) {
      expect(horizon).toBeLessThanOrEqual(
        Date.now() - SANDBOX_RUN_SESSION_RECLAIM_GRACE_MS,
      );
      expect(horizon).toBeGreaterThanOrEqual(
        before - SANDBOX_RUN_SESSION_RECLAIM_GRACE_MS,
      );
    }
    // Same fair walk as the reconcile pass.
    expect(select?.text).toContain(
      'ORDER BY s.last_reconciled_at_ms ASC NULLS FIRST, s.created_at_ms ASC',
    );
  });

  it('skipReconcile skips both spawner-facing passes', async () => {
    const { sql, statements } = fakeSql({
      reconcile: [[candidate('never')]],
      reclaim: [[candidate('never-either')]],
    });
    const spawner: WatchdogSpawner = {
      isAlive: vi.fn(() => Promise.resolve(true)),
      destroyIfIdle: vi.fn(() =>
        Promise.resolve({ destroyed: true, busy: false }),
      ),
    };

    const result = await runSandboxWatchdog(sql, {
      skipReconcile: true,
      spawner,
    });

    expect(result).toEqual({ expired: 0, healed: 0, reclaimed: 0 });
    expect(reconcileSession).not.toHaveBeenCalled();
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    expect(
      statements.some((s) => s.text.includes("s.owner_type = 'workflow_run'")),
    ).toBe(false);
    expect(stampsOf(statements)).toHaveLength(0);
  });
});
