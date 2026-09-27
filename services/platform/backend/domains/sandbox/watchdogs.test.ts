// @vitest-environment node

/**
 * Unit lock for the sandbox sweep's passes: the TTL expiry spares a session
 * while one of its running ops is live (last sign of life inside the recovery
 * window) and lets it go once that op falls silent, the reconcile batch is a
 * FAIR walk (least-recently-visited first, every visited row stamped — not
 * the 25 globally-oldest rows forever), the ended-run reclaim settles a row
 * only when the spawner confirmed the session is gone or idle (busy and
 * errors leave it for the next tick), and the failed-create collect destroys
 * a session only when no newer or live incarnation carries its id, then
 * stamps that one row. The real-Postgres probe (`integration-check.ts`)
 * proves the live-turn spare, the rotation and the reclaim and collect guards
 * on the actual schema.
 */

import type { Sql } from 'postgres';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { wakeParkedAgentRuns } from '../tasks/agent-runs.ts';
import { revokeSessionGatewayKeys } from './gateway-keys.ts';
import { RECOVERY_STALE_MS } from './recovery.ts';
import { reconcileSession } from './service.ts';
import { markSessionDestroyed } from './sessions.ts';
import {
  reconcileOrgSessions,
  runSandboxWatchdog,
  SANDBOX_FAILED_SESSION_COLLECT_GRACE_MS,
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
vi.mock('./gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(() =>
    Promise.resolve({ revoked: 0, failed: 0 }),
  ),
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
 * Scripted `sql`: the EXPIRE update and the reconcile, reclaim and collect
 * SELECTs pop from their scripts; the supersession probe answers from
 * `superseded` (row ids) and a collected row's stamp settles it; the visit
 * stamps answer with no rows. Every statement is recorded for shape
 * assertions.
 */
function fakeSql(script: {
  expire?: { orgId: string; sessionId: string }[][];
  reconcile?: Candidate[][];
  reclaim?: Candidate[][];
  collect?: Candidate[][];
  superseded?: string[];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes("SET status = 'expired'")) {
      return Promise.resolve(script.expire?.shift() ?? []);
    }
    if (text.includes("s.owner_type = 'workflow_run'")) {
      return Promise.resolve(script.reclaim?.shift() ?? []);
    }
    if (
      text.includes('SELECT id, session_id') &&
      text.includes("WHERE status IN ('creating', 'active', 'degraded')")
    ) {
      return Promise.resolve(script.reconcile?.shift() ?? []);
    }
    if (text.includes("WHERE status = 'failed' AND destroyed_at_ms IS NULL")) {
      return Promise.resolve(script.collect?.shift() ?? []);
    }
    if (text.includes('AS superseded')) {
      const rowId = String(values[0]);
      return Promise.resolve([
        { superseded: script.superseded?.includes(rowId) === true },
      ]);
    }
    if (text.includes('SET destroyed_at_ms')) {
      return Promise.resolve([{ id: values[1] }]);
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

const collectStampsOf = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes('SET destroyed_at_ms'));

const expiriesOf = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes("SET status = 'expired'"));

beforeEach(() => {
  vi.mocked(reconcileSession).mockResolvedValue('live');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runSandboxWatchdog — expiry spares a live turn', () => {
  // A fixed tick, so the cuts the EXPIRE update binds are exact.
  const NOW = 1_790_000_000_000;
  let clock: MockInstance<() => number>;

  beforeEach(() => {
    clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    clock.mockRestore();
  });

  // The regression: every unpinned session past its TTL expired whatever
  // ran in it, so a turn still working when the window lapsed had its model
  // key revoked mid-turn and its slot handed to a parked run.
  it('keeps a session past its TTL while one of its running ops signed its lease inside the recovery window', async () => {
    const { sql, statements } = fakeSql({});

    const result = await runSandboxWatchdog(sql, { skipReconcile: true });

    const expiries = expiriesOf(statements);
    expect(expiries).toHaveLength(1);
    const expire = expiries[0];
    // The TTL cut, then the live cut one recovery window before the tick.
    expect(expire?.values).toEqual([NOW, NOW - RECOVERY_STALE_MS]);
    expect(expire?.text).toContain('s.pinned = false AND s.expires_at_ms < ?');
    // Only a RUNNING op of the same session and organization holds it — a
    // finished op spares nothing, whatever its stamps say…
    expect(expire?.text).toMatch(
      /AND NOT EXISTS \(\s*SELECT 1 FROM app\.sandbox_session_ops op\s+WHERE op\.session_id = s\.session_id AND op\.org_id = s\.org_id\s+AND op\.status = 'running'/,
    );
    // …and only while it is live by the re-attach sweeps' own rule: its last
    // sign of life (`sessionOpLastSignOfLifeMs`) at or after the live cut.
    expect(expire?.text).toMatch(
      /greatest\(\s*op\.started_at_ms,\s*coalesce\(op\.heartbeat_at_ms, 0\),\s*coalesce\(op\.finalized_at_ms, 0\),\s*coalesce\(op\.finished_at_ms, 0\)\s*\) >= \?/,
    );
    // Spared: the turn keeps its keys and its slot.
    expect(result.expired).toBe(0);
    expect(revokeSessionGatewayKeys).not.toHaveBeenCalled();
    expect(wakeParkedAgentRuns).not.toHaveBeenCalled();
  });

  it('expires it once that op falls silent past the window, so a dead op cannot pin the session, and reclaims its keys', async () => {
    // Tick 1: the op's last heartbeat was a minute ago, inside the window,
    // and Postgres spares the session. Tick 2, one window later with no
    // heartbeat since: the op is stale and the session expires with the full
    // teardown.
    const { sql, statements } = fakeSql({
      expire: [[], [{ orgId: 'org_1', sessionId: 'ses-stale' }]],
    });

    const first = await runSandboxWatchdog(sql, { skipReconcile: true });
    clock.mockReturnValue(NOW + RECOVERY_STALE_MS);
    const second = await runSandboxWatchdog(sql, { skipReconcile: true });

    // The live cut moves with every tick, so no op outlasts it by going
    // quiet: tick 2's cut is past the heartbeat tick 1 still counted.
    expect(expiriesOf(statements).map((s) => s.values[1])).toEqual([
      NOW - RECOVERY_STALE_MS,
      NOW,
    ]);
    expect(first.expired).toBe(0);
    expect(second.expired).toBe(1);
    expect(revokeSessionGatewayKeys).toHaveBeenCalledTimes(1);
    expect(revokeSessionGatewayKeys).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      sessionId: 'ses-stale',
    });
    expect(wakeParkedAgentRuns).toHaveBeenCalledTimes(1);
    expect(wakeParkedAgentRuns).toHaveBeenCalledWith(sql, 'org_1');
  });
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

  it('skipReconcile skips every spawner-facing pass', async () => {
    const { sql, statements } = fakeSql({
      reconcile: [[candidate('never')]],
      reclaim: [[candidate('never-either')]],
      collect: [[candidate('never-collected')]],
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

    expect(result).toEqual({
      expired: 0,
      healed: 0,
      reclaimed: 0,
      collected: 0,
      settled: 0,
    });
    expect(reconcileSession).not.toHaveBeenCalled();
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    expect(
      statements.some((s) => s.text.includes("s.owner_type = 'workflow_run'")),
    ).toBe(false);
    expect(
      statements.some((s) => s.text.includes("WHERE status = 'failed'")),
    ).toBe(false);
    expect(stampsOf(statements)).toHaveLength(0);
    expect(collectStampsOf(statements)).toHaveLength(0);
  });
});

describe('runSandboxWatchdog — collect of failed creates', () => {
  const idleSpawner = (
    destroyIfIdle: WatchdogSpawner['destroyIfIdle'],
  ): WatchdogSpawner => ({
    isAlive: vi.fn(() => Promise.resolve(true)),
    destroyIfIdle,
  });

  // The regression (#3494): a failed row was never visited by any pass, so
  // the container its create left behind (Docker state `created`) and its
  // host workspace outlived the run by days.
  it('collects a failed row whose spawner session is still live: destroyed when idle, then that row alone is stamped by id', async () => {
    const live = candidate('failed-live');
    const gone = candidate('failed-gone');
    const { sql, statements } = fakeSql({ collect: [[live, gone]] });
    const destroyIfIdle = vi.fn((sessionId: string) =>
      Promise.resolve({ destroyed: sessionId === live.sessionId, busy: false }),
    );

    const result = await runSandboxWatchdog(sql, {
      spawner: idleSpawner(destroyIfIdle),
    });

    expect(result.collected).toBe(2);
    expect(destroyIfIdle).toHaveBeenCalledTimes(2);
    expect(destroyIfIdle).toHaveBeenCalledWith(live.sessionId);
    expect(destroyIfIdle).toHaveBeenCalledWith(gone.sessionId);
    // Destroyed now, or nothing left spawner-side: both rows settle — by
    // primary key, keeping `failed`. `markSessionDestroyed` would settle
    // every row and token under the session id.
    const stamps = collectStampsOf(statements);
    expect(stamps.map((s) => s.values[1])).toEqual([live.id, gone.id]);
    for (const stamp of stamps) {
      expect(stamp.text).toMatch(/SET destroyed_at_ms = \?\s+WHERE id = \?/);
      expect(stamp.text).toContain("AND status = 'failed'");
      expect(stamp.text).toContain('AND destroyed_at_ms IS NULL');
    }
    expect(markSessionDestroyed).not.toHaveBeenCalled();
    expect(stampsOf(statements)[0]?.values).toContainEqual([live.id, gone.id]);
  });

  it('never destroys a session a newer or live incarnation carries: the superseded row is stamped without a spawner call', async () => {
    const superseded = candidate('failed-superseded');
    const latest = candidate('failed-latest');
    const { sql, statements } = fakeSql({
      collect: [[superseded, latest]],
      superseded: [superseded.id],
    });
    const destroyIfIdle = vi.fn(() =>
      Promise.resolve({ destroyed: true, busy: false }),
    );

    const result = await runSandboxWatchdog(sql, {
      spawner: idleSpawner(destroyIfIdle),
    });

    expect(result.collected).toBe(2);
    expect(destroyIfIdle).toHaveBeenCalledTimes(1);
    expect(destroyIfIdle).toHaveBeenCalledWith(latest.sessionId);
    expect(collectStampsOf(statements).map((s) => s.values[1])).toEqual([
      superseded.id,
      latest.id,
    ]);
    // Asked per row, just before the spawner call; a newer row of any
    // status or a live row of any age — across the deployment, since the
    // spawner's session namespace is.
    const probes = statements.filter((s) => s.text.includes('AS superseded'));
    expect(probes.map((s) => s.values[0])).toEqual([superseded.id, latest.id]);
    expect(probes[0]?.text).toContain('n.session_id = f.session_id');
    expect(probes[0]?.text).toContain('n.created_at_ms > f.created_at_ms');
    expect(probes[0]?.values).toContainEqual([
      'creating',
      'active',
      'degraded',
      'stopped',
    ]);
    expect(probes[0]?.text).not.toContain('org_id');
  });

  it('leaves a busy session and a spawner error for a later tick — unstamped but visited', async () => {
    const busy = candidate('failed-busy');
    const broken = candidate('failed-broken');
    const { sql, statements } = fakeSql({ collect: [[busy, broken]] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const destroyIfIdle = vi.fn((sessionId: string) =>
      sessionId === busy.sessionId
        ? Promise.resolve({ destroyed: false, busy: true })
        : Promise.reject(new Error('spawner 502')),
    );

    const result = await runSandboxWatchdog(sql, {
      spawner: idleSpawner(destroyIfIdle),
    });

    expect(result.collected).toBe(0);
    expect(destroyIfIdle).toHaveBeenCalledTimes(2);
    expect(collectStampsOf(statements)).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed-session destroy failed'),
      expect.any(Error),
    );
    expect(stampsOf(statements)[0]?.values).toContainEqual([
      busy.id,
      broken.id,
    ]);
  });

  it('targets only unstamped failed rows past the grace, in the fair order', async () => {
    const { sql, statements } = fakeSql({});
    const before = Date.now();

    await runSandboxWatchdog(sql, {
      spawner: idleSpawner(
        vi.fn(() => Promise.resolve({ destroyed: true, busy: false })),
      ),
    });

    const select = statements.find((s) =>
      s.text.includes("WHERE status = 'failed' AND destroyed_at_ms IS NULL"),
    );
    expect(select).toBeDefined();
    // Counted from the failed flip (it stamps `last_activity_at_ms`).
    expect(select?.text).toContain(
      'coalesce(last_activity_at_ms, created_at_ms) < ?',
    );
    const horizon = select?.values[0];
    expect(typeof horizon).toBe('number');
    expect(horizon).toBeLessThanOrEqual(
      Date.now() - SANDBOX_FAILED_SESSION_COLLECT_GRACE_MS,
    );
    expect(horizon).toBeGreaterThanOrEqual(
      before - SANDBOX_FAILED_SESSION_COLLECT_GRACE_MS,
    );
    expect(select?.values[1]).toBe(25);
    expect(select?.text).toContain(
      'ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC',
    );
  });
});

describe('reconcileOrgSessions — the Sandboxes page mount probe', () => {
  // The regression: the page's probe walked EVERY live row of the org,
  // hibernated (`stopped`) ones included, and settled each spawner 404 as
  // destroyed — so opening the page emptied it of idle project workspaces
  // (their containers are reaped by design; the workspace waits on disk).
  // The probe is now the sweep's own compute-holding-only pass, org-scoped.
  it('runs the compute-holding-only fair pass scoped to the org, probes with the given spawner, and stamps the visit', async () => {
    const batch = [candidate('a'), candidate('b')];
    const { sql, statements } = fakeSql({ reconcile: [batch] });
    const spawner: WatchdogSpawner = {
      isAlive: vi.fn(() => Promise.resolve(true)),
      destroyIfIdle: vi.fn(() =>
        Promise.resolve({ destroyed: false, busy: false }),
      ),
    };
    vi.mocked(reconcileSession).mockResolvedValueOnce('healed');

    const result = await reconcileOrgSessions(sql, 'org_1', spawner);

    expect(result).toEqual({ healed: 1 });
    const select = statements.find(
      (s) =>
        s.text.includes('SELECT id, session_id') &&
        s.text.includes("WHERE status IN ('creating', 'active', 'degraded')"),
    );
    // `stopped` is not a candidate status, the walk is scoped to the org and
    // stays the sweep's fair rotation with the page's batch of 25.
    expect(select?.text).not.toContain("'stopped'");
    expect(select?.text).toContain('org_id = ?');
    expect(select?.text).toContain(
      'ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC',
    );
    expect(select?.values).toEqual(['org_1', 'org_1', 25]);
    expect(reconcileSession).toHaveBeenCalledTimes(2);
    for (const c of batch) {
      expect(reconcileSession).toHaveBeenCalledWith(
        sql,
        { organizationId: c.orgId, sessionId: c.sessionId },
        { isAlive: spawner.isAlive },
      );
    }
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    const stamps = stampsOf(statements);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.values[1]).toEqual(['a', 'b']);
  });

  it('leaves the sweep tick unscoped (a null scope matches every org)', async () => {
    const { sql, statements } = fakeSql({ reconcile: [[candidate('x')]] });

    await runSandboxWatchdog(sql, {
      reconcileBatch: 1,
      spawner: {
        isAlive: vi.fn(() => Promise.resolve(true)),
        destroyIfIdle: vi.fn(() =>
          Promise.resolve({ destroyed: false, busy: false }),
        ),
      },
    });

    const select = statements.find(
      (s) =>
        s.text.includes('SELECT id, session_id') &&
        s.text.includes("WHERE status IN ('creating', 'active', 'degraded')"),
    );
    expect(select?.values).toEqual([null, null, 1]);
  });
});
