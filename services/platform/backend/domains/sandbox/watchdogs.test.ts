// @vitest-environment node

/**
 * Unit lock for the sandbox sweep's passes: the TTL expiry spares a session
 * while one of its running ops is live (last sign of life inside the recovery
 * window) and lets it go once that op falls silent, the reconcile batch is a
 * FAIR walk (least-recently-visited first, every visited row stamped — not
 * the 25 globally-oldest rows forever) that hands each row the whole spawner
 * (a pinned row is re-pinned or its recreate queued, `service.test.ts` owns
 * how) and counts a queued recreate apart from a heal, stops visiting rows
 * once the job's signal aborts (stamping only the rows it visited), the
 * ended-run reclaim settles a row
 * only when the spawner confirmed the session is gone or idle (busy and
 * errors leave it for the next tick), and the failed-create collect removes
 * a session only when no newer or live incarnation carries its id — an agent
 * session's compute alone, keeping its workspace — then stamps that one row,
 * and the render release destroys the idle session of
 * a render row older than a scan link can keep one. Every tick also deletes the settled model-endpoint
 * request rows a week old, between closing the lost requests and the
 * settlement sweep, and a failure there stops neither. The real-Postgres
 * probe (`integration-check.ts`)
 * proves the live-turn spare, the rotation, the queued pinned recreate and
 * the reclaim and collect guards on the actual schema.
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
  SANDBOX_RENDER_SESSION_MAX_AGE_MS,
  SANDBOX_RUN_SESSION_RECLAIM_GRACE_MS,
  type WatchdogSpawner,
} from './watchdogs.ts';

vi.mock('../../core/node_only/sandbox/helpers/session_client.ts', () => ({
  sandboxWorkspaceInventory: vi.fn(),
  sessionCreate: vi.fn(),
  sessionIsAlive: vi.fn(),
  sessionObserve: vi.fn(),
  sessionDestroyIfIdle: vi.fn(),
  sessionSetPinned: vi.fn(),
  sessionStopIfIdle: vi.fn(),
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
  ownerType?: string;
}

/**
 * Scripted `sql`: the EXPIRE update and the reconcile, reclaim, collect and
 * release SELECTs pop from their scripts; the supersession probe answers from
 * `superseded` (row ids) and a collected row's stamp settles it; the sweep
 * of settled model-endpoint rows pops from `sweep` (or fails with
 * `sweepError`); the visit stamps answer with no rows. Every statement is
 * recorded for shape assertions.
 */
function fakeSql(script: {
  expire?: { orgId: string; sessionId: string }[][];
  reconcile?: Candidate[][];
  historical?: Candidate[][];
  reclaim?: Candidate[][];
  collect?: Candidate[][];
  release?: Candidate[][];
  superseded?: string[];
  sweep?: { id: string }[][];
  sweepError?: Error;
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes("SET status = 'expired'")) {
      return Promise.resolve(script.expire?.shift() ?? []);
    }
    if (text.includes('DELETE FROM app.sandbox_session_ops')) {
      if (script.sweepError !== undefined) {
        return Promise.reject(script.sweepError);
      }
      return Promise.resolve(script.sweep?.shift() ?? []);
    }
    if (text.includes("s.owner_type = 'workflow_run'")) {
      return Promise.resolve(script.reclaim?.shift() ?? []);
    }
    if (
      text.includes('SELECT id, session_id') &&
      text.includes("status IN ('creating', 'active', 'degraded')")
    ) {
      return Promise.resolve(script.reconcile?.shift() ?? []);
    }
    if (
      text.includes("WHERE status IN ('stopped', 'expired') AND pinned = false")
    ) {
      return Promise.resolve(script.historical?.shift() ?? []);
    }
    if (text.includes("WHERE status = 'failed' AND destroyed_at_ms IS NULL")) {
      return Promise.resolve(script.collect?.shift() ?? []);
    }
    if (text.includes("WHERE owner_type = 'render'")) {
      return Promise.resolve(script.release?.shift() ?? []);
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

/** A scripted spawner: every session alive, every pin taken, every create,
 * idle destroy and idle stop served — a test overrides the verbs it
 * scripts. */
function scriptedSpawner(
  overrides: Partial<WatchdogSpawner> = {},
): WatchdogSpawner {
  return {
    isAlive: vi.fn(() => Promise.resolve(true)),
    setPinned: vi.fn(() => Promise.resolve(true)),
    create: vi.fn(() => Promise.resolve(undefined)),
    destroyIfIdle: vi.fn(() =>
      Promise.resolve({ destroyed: true, busy: false }),
    ),
    stopIfIdle: vi.fn(() => Promise.resolve({ stopped: true, busy: false })),
    ...overrides,
  };
}

const idleAnswer = (): WatchdogSpawner['destroyIfIdle'] =>
  vi.fn(() => Promise.resolve({ destroyed: false, busy: false }));

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
  it('keeps a session past its TTL while one of its running ops signed its lease inside the recovery window [SBX-R10]', async () => {
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
  it('reserves independently rotated active and historical quotas without increasing fanout or batch size', async () => {
    const active = Array.from({ length: 20 }, (_, index) =>
      candidate(`active-${index}`),
    );
    const historical = Array.from({ length: 5 }, (_, index) =>
      candidate(`cold-${index}`),
    );
    const { sql, statements } = fakeSql({
      reconcile: [active],
      historical: [historical],
    });
    const spawner = {
      ...scriptedSpawner(),
      observe: async () => ({ pinned: true }),
    };

    await runSandboxWatchdog(sql, { spawner });

    const activeSelect = statements.find((s) =>
      s.text.includes("WHERE status IN ('creating', 'active', 'degraded')"),
    );
    const pinSelect = statements.find((s) =>
      s.text.includes(
        "WHERE status IN ('stopped', 'expired') AND pinned = false",
      ),
    );
    expect(activeSelect?.values).toEqual([null, null, 20]);
    expect(pinSelect?.values).toEqual([null, null, 5]);
    expect(pinSelect?.text).toContain(
      'newer.session_id = sandbox_sessions.session_id',
    );
    expect(pinSelect?.text).toContain('newer.created_at_ms, newer.id');
    expect(pinSelect?.text).toContain(
      'ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC',
    );
    expect(reconcileSession).toHaveBeenCalledTimes(25);
    expect(
      vi
        .mocked(reconcileSession)
        .mock.calls.slice(0, 6)
        .map((call) => call[1].sessionId),
    ).toEqual([
      'ses-active-0',
      'ses-active-1',
      'ses-active-2',
      'ses-active-3',
      'ses-cold-0',
      'ses-active-4',
    ]);
    expect(stampsOf(statements)[0]?.values[0]).toHaveLength(25);
  });

  it('walks least-recently-visited first, probes with the injected spawner, and stamps every visited row', async () => {
    const batch = [candidate('a'), candidate('b'), candidate('c')];
    const { sql, statements } = fakeSql({ reconcile: [batch] });
    const spawner = scriptedSpawner({ destroyIfIdle: idleAnswer() });
    vi.mocked(reconcileSession).mockResolvedValueOnce('healed');

    const result = await runSandboxWatchdog(sql, {
      reconcileBatch: 3,
      spawner,
    });

    expect(result).toMatchObject({ healed: 1, reclaimed: 0 });
    const select = statements.find(
      (s) =>
        s.text.includes('SELECT id, session_id') &&
        s.text.includes("status IN ('creating', 'active', 'degraded')"),
    );
    // The rotation: never-visited rows first, then the stalest visit — NOT
    // `ORDER BY created_at_ms`, which parked the same 25 oldest rows at the
    // head of every tick.
    expect(select?.text).toContain(
      'ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC',
    );
    expect(select?.values).toContain(3);

    // Each candidate reconciled through the injected spawner — its liveness
    // probe and the pin and create verbs a pinned row needs.
    expect(reconcileSession).toHaveBeenCalledTimes(3);
    for (const row of batch) {
      expect(reconcileSession).toHaveBeenCalledWith(
        sql,
        { organizationId: row.orgId, sessionId: row.sessionId },
        spawner,
        expect.any(Object),
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
      spawner: scriptedSpawner({ destroyIfIdle: idleAnswer() }),
    });

    expect(result.healed).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(stampsOf(statements)[0]?.values).toContainEqual(['x', 'y']);
  });
});

describe('runSandboxWatchdog — the workspace inventory in the reconcile', () => {
  // A host reboot leaves every session's compute gone at once, and each
  // agent session's heal asks whether its workspace is still held.
  it('reads the inventory at most once per pass, however many rows heal [SBX-R17]', async () => {
    const { sql } = fakeSql({
      reconcile: [[candidate('gone-a'), candidate('gone-b'), candidate('c')]],
    });
    const inventory = vi.fn(() =>
      Promise.resolve({
        backend: 'docker' as const,
        workspaces: [],
        organizations: [],
      }),
    );
    vi.mocked(reconcileSession).mockImplementation(
      async (_sql, args, spawner) => {
        if (args.sessionId === 'ses-c') return 'live';
        await spawner?.inventory?.();
        return 'healed';
      },
    );

    const result = await runSandboxWatchdog(sql, {
      spawner: scriptedSpawner({ inventory }),
    });

    expect(result.healed).toBe(2);
    expect(inventory).toHaveBeenCalledOnce();
  });

  it('reads it again on the next pass', async () => {
    const inventory = vi.fn(() => Promise.resolve(null));
    vi.mocked(reconcileSession).mockImplementation(
      async (_sql, _args, spawner) => {
        await spawner?.inventory?.();
        return 'healed';
      },
    );
    for (let pass = 0; pass < 2; pass += 1) {
      const { sql } = fakeSql({ reconcile: [[candidate(`gone-${pass}`)]] });
      await runSandboxWatchdog(sql, {
        spawner: scriptedSpawner({ inventory }),
      });
    }
    expect(inventory).toHaveBeenCalledTimes(2);
  });
});

describe('runSandboxWatchdog — pinned sessions in the reconcile', () => {
  it('counts a pinned session whose recreate it queued apart from a healed phantom', async () => {
    const { sql } = fakeSql({
      reconcile: [[candidate('pinned'), candidate('phantom'), candidate('up')]],
    });
    vi.mocked(reconcileSession)
      .mockResolvedValueOnce('recreating')
      .mockResolvedValueOnce('healed')
      .mockResolvedValueOnce('repinned');

    const result = await runSandboxWatchdog(sql, {
      reconcileBatch: 3,
      spawner: scriptedSpawner(),
    });

    expect(result).toMatchObject({ healed: 1, recreating: 1 });
  });

  it('hands an injected recreate scheduler to every row it reconciles', async () => {
    const { sql } = fakeSql({ reconcile: [[candidate('pinned')]] });
    const spawner = scriptedSpawner();
    const scheduleRecreate = vi.fn(async () => {});

    await runSandboxWatchdog(sql, {
      reconcileBatch: 1,
      spawner,
      scheduleRecreate,
    });
    await reconcileOrgSessions(sql, 'org_1', spawner, scheduleRecreate);

    expect(reconcileSession).toHaveBeenCalledWith(
      sql,
      { organizationId: 'org_1', sessionId: 'ses-pinned' },
      spawner,
      expect.objectContaining({ schedule: scheduleRecreate }),
    );
  });

  it('keeps the Sandboxes page probe answering its healed count alone', async () => {
    const { sql } = fakeSql({
      reconcile: [[candidate('pinned'), candidate('phantom')]],
    });
    vi.mocked(reconcileSession)
      .mockResolvedValueOnce('recreating')
      .mockResolvedValueOnce('healed');

    await expect(
      reconcileOrgSessions(sql, 'org_1', scriptedSpawner()),
    ).resolves.toEqual({ healed: 1 });
  });
});

describe('runSandboxWatchdog — the job signal', () => {
  it('stops visiting rows once pg-boss gives up on the tick and stamps only the rows it visited', async () => {
    const controller = new AbortController();
    const { sql, statements } = fakeSql({
      reconcile: [[candidate('a'), candidate('b'), candidate('c')]],
    });
    const spawner = scriptedSpawner();
    // The tick's expiry lapses while the second row is probed.
    vi.mocked(reconcileSession)
      .mockResolvedValueOnce('live')
      .mockImplementationOnce(async () => {
        controller.abort();
        return 'live';
      });

    await runSandboxWatchdog(sql, {
      reconcileBatch: 3,
      spawner,
      signal: controller.signal,
    });

    expect(reconcileSession).toHaveBeenCalledTimes(2);
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    // Row c is left unstamped, so the retry (or the next tick) starts at it.
    const stamps = stampsOf(statements);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.values).toContainEqual(['a', 'b']);
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
      spawner: scriptedSpawner({ destroyIfIdle }),
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

    await runSandboxWatchdog(sql, { spawner: scriptedSpawner() });

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
    const spawner = scriptedSpawner();

    const result = await runSandboxWatchdog(sql, {
      skipReconcile: true,
      spawner,
    });

    expect(result).toEqual({
      expired: 0,
      healed: 0,
      recreating: 0,
      reclaimed: 0,
      collected: 0,
      released: 0,
      settled: 0,
    });
    expect(reconcileSession).not.toHaveBeenCalled();
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    expect(
      statements.some((s) => s.text.includes("s.owner_type = 'workflow_run'")),
    ).toBe(false);
    expect(
      statements.some((s) =>
        s.text.includes("status = 'failed' AND destroyed_at_ms IS NULL"),
      ),
    ).toBe(false);
    expect(stampsOf(statements)).toHaveLength(0);
    expect(collectStampsOf(statements)).toHaveLength(0);
  });
});

describe('runSandboxWatchdog — collect of failed creates', () => {
  const idleSpawner = (
    destroyIfIdle: WatchdogSpawner['destroyIfIdle'],
  ): WatchdogSpawner => scriptedSpawner({ destroyIfIdle });

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
    expect(destroyIfIdle).toHaveBeenCalledWith(live.sessionId, {
      signal: expect.any(AbortSignal),
    });
    expect(destroyIfIdle).toHaveBeenCalledWith(gone.sessionId, {
      signal: expect.any(AbortSignal),
    });
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
    expect(destroyIfIdle).toHaveBeenCalledWith(latest.sessionId, {
      signal: expect.any(AbortSignal),
    });
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
      expect.stringContaining('failed-session collect failed'),
      expect.any(Error),
    );
    expect(stampsOf(statements)[0]?.values).toContainEqual([
      busy.id,
      broken.id,
    ]);
  });

  // An agent session's id may name a workspace preserved for the owner's
  // next turn — its last container lost to a host reboot or the OOM killer
  // — so its leftover loses its compute alone. A render's is disposable.
  it('stops an agent session keeping its workspace, and destroys a render session whole [SBX-R17]', async () => {
    const project = {
      ...candidate('failed-project'),
      ownerType: 'project_agent',
    };
    const run = { ...candidate('failed-run'), ownerType: 'workflow_run' };
    const render = { ...candidate('failed-render'), ownerType: 'render' };
    const { sql, statements } = fakeSql({
      collect: [[project, run, render]],
    });
    const spawner = scriptedSpawner();

    const result = await runSandboxWatchdog(sql, { spawner });

    expect(result.collected).toBe(3);
    expect(vi.mocked(spawner.stopIfIdle).mock.calls.map(([id]) => id)).toEqual([
      project.sessionId,
      run.sessionId,
    ]);
    expect(
      vi.mocked(spawner.destroyIfIdle).mock.calls.map(([id]) => id),
    ).toEqual([render.sessionId]);
    expect(collectStampsOf(statements).map((s) => s.values[1])).toEqual([
      project.id,
      run.id,
      render.id,
    ]);
    const select = statements.find((s) =>
      s.text.includes("WHERE status = 'failed' AND destroyed_at_ms IS NULL"),
    );
    expect(select?.text).toContain('owner_type AS "ownerType"');
  });

  it('leaves an agent session a turn is executing in for a later tick', async () => {
    const busy = {
      ...candidate('failed-busy-agent'),
      ownerType: 'project_agent',
    };
    const { sql, statements } = fakeSql({ collect: [[busy]] });
    const spawner = scriptedSpawner({
      stopIfIdle: vi.fn(() => Promise.resolve({ stopped: false, busy: true })),
    });

    const result = await runSandboxWatchdog(sql, { spawner });

    expect(result.collected).toBe(0);
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    expect(collectStampsOf(statements)).toHaveLength(0);
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

/**
 * A scan link destroys its render session when its batch ends. A link cut
 * off mid-batch (a restart, a deploy, a crash) left the row `active` and the
 * container running, and no pass reached either; each held one of the
 * organization's two render slots until the spawner's idle reaper took the
 * container half an hour later.
 */
describe('runSandboxWatchdog — release of abandoned render sessions', () => {
  it('settles the row only when the spawner destroyed (or lacked) the session; a worker still rendering and an error wait for the next tick', async () => {
    const abandoned = candidate('abandoned');
    const rendering = candidate('rendering');
    const broken = candidate('broken');
    const { sql, statements } = fakeSql({
      release: [[abandoned, rendering, broken]],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const destroyIfIdle = vi.fn((sessionId: string) => {
      if (sessionId === rendering.sessionId) {
        return Promise.resolve({ destroyed: false, busy: true });
      }
      if (sessionId === broken.sessionId) {
        return Promise.reject(new Error('spawner 502'));
      }
      return Promise.resolve({ destroyed: true, busy: false });
    });

    const result = await runSandboxWatchdog(sql, {
      spawner: scriptedSpawner({ destroyIfIdle }),
    });

    expect(result.released).toBe(1);
    expect(destroyIfIdle).toHaveBeenCalledTimes(3);
    expect(markSessionDestroyed).toHaveBeenCalledTimes(1);
    expect(markSessionDestroyed).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      sessionId: abandoned.sessionId,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('render-session release failed'),
      expect.any(Error),
    );
    // All three were visited: stamped so the rotation moves on.
    const stamps = stampsOf(statements);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.values).toContainEqual([
      'abandoned',
      'rendering',
      'broken',
    ]);
  });

  it('targets only compute-holding render rows older than a link can keep one', async () => {
    const { sql, statements } = fakeSql({});
    const before = Date.now();

    await runSandboxWatchdog(sql, { spawner: scriptedSpawner() });

    const select = statements.find((s) =>
      s.text.includes("WHERE owner_type = 'render'"),
    );
    expect(select).toBeDefined();
    // A destroyed, failed or expired row holds no slot; nothing to release.
    expect(select?.text).toContain("status IN ('creating', 'active')");
    // A batch that is rendering now is younger than this.
    expect(select?.text).toContain('created_at_ms <');
    const horizon = select?.values.find(
      (value): value is number =>
        typeof value === 'number' && value > 1_000_000_000_000,
    );
    expect(horizon).toBeLessThanOrEqual(
      Date.now() - SANDBOX_RENDER_SESSION_MAX_AGE_MS,
    );
    expect(horizon).toBeGreaterThanOrEqual(
      before - SANDBOX_RENDER_SESSION_MAX_AGE_MS,
    );
    expect(select?.text).toContain(
      'ORDER BY last_reconciled_at_ms ASC NULLS FIRST, created_at_ms ASC',
    );
  });

  it('is skipped with the other spawner-facing passes', async () => {
    const { sql, statements } = fakeSql({ release: [[candidate('never')]] });
    const spawner = scriptedSpawner();

    const result = await runSandboxWatchdog(sql, {
      skipReconcile: true,
      spawner,
    });

    expect(result.released).toBe(0);
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    expect(
      statements.some((s) => s.text.includes("WHERE owner_type = 'render'")),
    ).toBe(false);
  });
});

describe('runSandboxWatchdog — settled model-endpoint request rows', () => {
  const NOW = 1_790_000_000_000;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  let clock: MockInstance<() => number>;

  beforeEach(() => {
    clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    clock.mockRestore();
  });

  const indexOf = (statements: Statement[], fragment: string): number =>
    statements.findIndex((s) => s.text.includes(fragment));

  it('deletes them on every tick, spawner or not, with the tick’s clock, after closing the lost requests and before the settlement sweep', async () => {
    const { sql, statements } = fakeSql({
      sweep: [[{ id: 'op-1' }, { id: 'op-2' }]],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await runSandboxWatchdog(sql, { skipReconcile: true });

    const sweeps = statements.filter(
      (s) =>
        s.text.includes('DELETE FROM app.sandbox_session_ops') &&
        s.text.includes("kind = 'model-api'"),
    );
    // Two rows came back from a batch of 1,000: one statement drained it.
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.values).toEqual([
      NOW - WEEK_MS,
      1_000,
      NOW - WEEK_MS,
      1_000,
      1_000,
    ]);
    const close = indexOf(statements, "status = 'failed', finished_at_ms");
    const sweep = indexOf(statements, "WHERE kind = 'model-api'");
    const settle = indexOf(statements, 'WHERE ((finalized_at_ms IS NOT NULL');
    expect(close).toBeGreaterThanOrEqual(0);
    expect(sweep).toBeGreaterThan(close);
    expect(settle).toBeGreaterThan(sweep);
    // The count is logged; the tick's result keeps its shape.
    expect(log).toHaveBeenCalledWith(
      '[watchdog] deleted the op rows of 2 settled model-endpoint request(s)',
    );
    expect(result).toEqual({
      expired: 0,
      healed: 0,
      recreating: 0,
      reclaimed: 0,
      collected: 0,
      released: 0,
      settled: 0,
    });
  });

  it('logs nothing when no row was due', async () => {
    const { sql } = fakeSql({});
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runSandboxWatchdog(sql, { skipReconcile: true });

    expect(log).not.toHaveBeenCalled();
  });

  it('logs a failed sweep and still runs the settlement sweep behind it', async () => {
    const failure = new Error('connection reset');
    const { sql, statements } = fakeSql({ sweepError: failure });
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      runSandboxWatchdog(sql, { skipReconcile: true }),
    ).resolves.toMatchObject({ settled: 0 });

    expect(error).toHaveBeenCalledWith(
      '[watchdog] deleting settled model-endpoint request rows failed:',
      failure,
    );
    expect(
      indexOf(statements, 'WHERE ((finalized_at_ms IS NOT NULL'),
    ).toBeGreaterThan(
      indexOf(statements, 'DELETE FROM app.sandbox_session_ops'),
    );
  });
});

describe('reconcileOrgSessions — the Sandboxes page mount probe', () => {
  // The regression: the page's probe walked EVERY live row of the org,
  // hibernated (`stopped`) ones included, and settled each spawner 404 as
  // destroyed — so opening the page emptied it of idle project workspaces
  // (their containers are reaped by design; the workspace waits on disk).
  // The shared pass repairs stale pins on retained workspaces without healing their 404s.
  it('runs the fair lifecycle and pin-drift pass scoped to the org and stamps each visit', async () => {
    const batch = [candidate('a'), candidate('b')];
    const { sql, statements } = fakeSql({ reconcile: [batch] });
    const spawner = scriptedSpawner({ destroyIfIdle: idleAnswer() });
    vi.mocked(reconcileSession).mockResolvedValueOnce('healed');

    const result = await reconcileOrgSessions(sql, 'org_1', spawner);

    expect(result).toEqual({ healed: 1 });
    const select = statements.find(
      (s) =>
        s.text.includes('SELECT id, session_id') &&
        s.text.includes("status IN ('creating', 'active', 'degraded')"),
    );
    // Legacy spawners cannot inspect retained pins, so the whole batch stays active.
    expect(select?.text).not.toContain("status IN ('stopped', 'expired')");
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
        spawner,
        { signal: expect.any(AbortSignal) },
      );
    }
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    const stamps = stampsOf(statements);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.values[0]).toEqual(['a', 'b']);
  });

  it('leaves the sweep tick unscoped (a null scope matches every org)', async () => {
    const { sql, statements } = fakeSql({ reconcile: [[candidate('x')]] });

    await runSandboxWatchdog(sql, {
      reconcileBatch: 1,
      spawner: scriptedSpawner({ destroyIfIdle: idleAnswer() }),
    });

    const select = statements.find(
      (s) =>
        s.text.includes('SELECT id, session_id') &&
        s.text.includes("status IN ('creating', 'active', 'degraded')"),
    );
    expect(select?.values).toEqual([null, null, 1]);
  });
});

describe('independent bounded sandbox watchdog passes', () => {
  it('reclaims ended runs, failed creates and render sessions while reconciliation is stalled', async () => {
    const { sql, statements } = fakeSql({
      reconcile: [[candidate('slow'), candidate('not-visited')]],
      reclaim: [[candidate('ended')]],
      collect: [[candidate('failed')]],
      release: [[candidate('render')]],
    });
    const events: string[] = [];
    vi.mocked(reconcileSession).mockImplementationOnce(
      async (_sql, _args, _spawner, options) => {
        const signal = options?.signal;
        if (signal === undefined) throw new Error('missing pass signal');
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              events.push('probe-aborted');
              reject(signal.reason);
            },
            { once: true },
          );
        });
        return 'live';
      },
    );
    const spawner = scriptedSpawner({
      destroyIfIdle: vi.fn(async (sessionId) => {
        events.push(sessionId);
        return { destroyed: true, busy: false };
      }),
    });
    const result = await runSandboxWatchdog(sql, {
      spawner,
      passTimeoutMs: 30,
    });
    expect(result).toMatchObject({
      reclaimed: 1,
      collected: 1,
      released: 1,
      healed: 0,
    });
    expect(events.at(-1)).toBe('probe-aborted');
    expect(events.slice(0, -1).sort()).toEqual([
      'ses-ended',
      'ses-failed',
      'ses-render',
    ]);
    expect(reconcileSession).toHaveBeenCalledOnce();
    const visited = stampsOf(statements).flatMap((entry) =>
      entry.values.flat(),
    );
    expect(visited).toContain('slow');
    expect(visited).not.toContain('not-visited');
  });

  it('limits concurrency to one session per independent pass', async () => {
    const { sql } = fakeSql({
      reconcile: [[candidate('a'), candidate('b')]],
      reclaim: [[candidate('c'), candidate('d')]],
      collect: [[candidate('e'), candidate('f')]],
      release: [[candidate('g'), candidate('h')]],
    });
    let active = 0;
    let peak = 0;
    const visit = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    };
    vi.mocked(reconcileSession).mockImplementation(async () => {
      await visit();
      return 'live';
    });
    const spawner = scriptedSpawner({
      destroyIfIdle: vi.fn(async () => {
        await visit();
        return { destroyed: true, busy: false };
      }),
    });
    await runSandboxWatchdog(sql, { spawner });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(active).toBe(0);
  });

  it('an already-aborted job visits and destroys no sessions in any pass', async () => {
    const { sql, statements } = fakeSql({
      reconcile: [[candidate('a')]],
      reclaim: [[candidate('b')]],
      collect: [[candidate('c')]],
      release: [[candidate('d')]],
    });
    const spawner = scriptedSpawner();
    await runSandboxWatchdog(sql, { spawner, signal: AbortSignal.abort() });
    expect(reconcileSession).not.toHaveBeenCalled();
    expect(spawner.destroyIfIdle).not.toHaveBeenCalled();
    expect(stampsOf(statements)).toEqual([]);
  });
});
