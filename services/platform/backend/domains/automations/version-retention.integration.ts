/** Real Postgres proof of the version retention sweep (`pruneVersions`, the
 * `automationVersions` category): saved versions older than the window go,
 * except the live one, the last deploys' versions, a version a run used, the
 * newest twenty and what those were restored from or based on, and a version
 * a held custodian saved; a second sweep removes nothing; a version number is
 * never reused; and a run starting on a version and the sweep reaching it at
 * the same moment agree in either order — the run is seen, or the version is
 * gone and no run starts. The lane deletes what it wrote before it ends. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { appOrigin } from '../../lib/write-origin.ts';
import { sweepOrgPhase2 } from '../retention/service.ts';
import {
  beginRunInTx,
  deleteAutomationCascade,
  deploy,
  saveVersion,
} from './store.ts';
import { pruneVersions, restoreVersion } from './versions.ts';
import { markAutomationWriterInTx } from './writer-protocol.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function checkVersionRetention(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const origin = appOrigin(userId);
  const swept = `itest-retention-${suffix}`;
  const raceRun = `itest-retention-run-${suffix}`;
  const raceSweep = `itest-retention-sweep-${suffix}`;
  const held = `itest-held-${suffix}`;
  const automations = [swept, raceRun, raceSweep];

  const save = (
    name: string,
    index: number,
    extra: { basedOnVersion?: number } = {},
  ) =>
    saveVersion(sql, {
      organizationId: orgId,
      name,
      document: {
        version: 1,
        name,
        nodes: [
          { id: 'a', type: 'transform', code: `return ${String(index)};` },
        ],
        output: '{{ nodes.a.output }}',
      },
      origin,
      ...extra,
    });
  /** Every version older than the window, as if saved long ago. */
  const age = (name: string, upTo: number) =>
    sql`
      UPDATE app.automations
      SET created_at_ms = ${Date.now() - 2 * WINDOW_DAYS * DAY_MS}
      WHERE org_id = ${orgId} AND name = ${name} AND version <= ${upTo}
    `;
  const versionsOf = async (name: string) =>
    (
      await sql<{ version: number }[]>`
        SELECT version FROM app.automations
        WHERE org_id = ${orgId} AND name = ${name} ORDER BY version
      `
    ).map((row) => row.version);
  const cutoff = () => Date.now() - WINDOW_DAYS * DAY_MS;

  try {
    // ---- the sweep: what goes and what stays
    for (let index = 1; index <= 30; index += 1) await save(swept, index);
    await deploy(sql, {
      organizationId: orgId,
      name: swept,
      version: 3,
      origin,
    });
    await deploy(sql, {
      organizationId: orgId,
      name: swept,
      version: 5,
      origin,
    });
    await sql.begin((tx) =>
      beginRunInTx(tx, {
        organizationId: orgId,
        name: swept,
        input: {},
        mode: 'mock',
        startedBy: userId,
        version: 4,
      }),
    );
    // v31 is restored from v2 and v32 is built from v6: both are among the
    // newest, so what they came from stays.
    await restoreVersion(sql, {
      organizationId: orgId,
      name: swept,
      version: 2,
      origin,
    });
    await save(swept, 32, { basedOnVersion: 6 });
    // Two versions a held custodian saved, one through an API key.
    await sql`
      UPDATE app.automations SET created_by = ${held}
      WHERE org_id = ${orgId} AND name = ${swept} AND version = 9
    `;
    await sql`
      UPDATE app.automations SET created_by = ${`api-key:${held}`}
      WHERE org_id = ${orgId} AND name = ${swept} AND version = 10
    `;
    await age(swept, 30);

    const policy = {
      organizationId: orgId,
      config: {
        automationVersionsEnabled: true,
        automationVersionsRetentionDays: WINDOW_DAYS,
      },
    };
    const holds = { orgHeld: false, userMembershipIds: new Set([held]) };
    const first = await sweepOrgPhase2(sql, policy, holds);
    const left = await versionsOf(swept);
    // Kept: the newest twenty (13–32), the live v5 and the deploys' v3 and
    // v5, the run's v4, what v31 and v32 came from (v2, v6), and the held
    // custodian's v9 and v10. Gone: v1, v7, v8, v11, v12.
    const want = [
      2,
      3,
      4,
      5,
      6,
      9,
      10,
      ...Array.from({ length: 20 }, (_, i) => i + 13),
    ];
    record(
      'the version sweep removes what nothing reads, and keeps the live and deployed versions, a run’s, the newest twenty, their lineage and a held custodian’s [AUTO-R51]',
      JSON.stringify(left) === JSON.stringify(want) &&
        first.automationVersions >= 5,
      `left=${JSON.stringify(left)}, want=${JSON.stringify(want)}, removed=${String(first.automationVersions)}`,
    );

    const audited = await sql<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM app.audit_logs
      WHERE org_id = ${orgId}
        AND action = 'automation_version.retention_deleted'
        AND metadata->>'automation' = ${swept}
    `;
    const hinted = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM app_realtime.outbox
      WHERE org_id = ${orgId} AND entity = 'automation' AND entity_id = ${swept}
    `;
    record(
      'the version sweep writes one audit row naming the versions it removed, and tells the builders that have the automation open',
      audited.length === 1 &&
        audited[0]?.metadata.deleted === 5 &&
        JSON.stringify(audited[0].metadata.versions) ===
          JSON.stringify([1, 7, 8, 11, 12]) &&
        Number(hinted[0]?.n ?? 0) > 0,
      JSON.stringify({ audited, hinted }),
    );

    const second = await sweepOrgPhase2(sql, policy, holds);
    const next = await save(swept, 33);
    record(
      'a second sweep removes nothing, and a version number is never reused',
      second.automationVersions === 0 &&
        JSON.stringify(await versionsOf(swept)) ===
          JSON.stringify([...want, 33]) &&
        next.version === 33,
      `second=${String(second.automationVersions)}, next=${String(next.version)}`,
    );

    const off = await sweepOrgPhase2(
      sql,
      {
        organizationId: orgId,
        config: { automationVersionsEnabled: false },
      },
      holds,
    );
    const underHold = await sweepOrgPhase2(sql, policy, {
      orgHeld: true,
      userMembershipIds: new Set(),
    });
    record(
      'the version sweep does nothing while its category is off, or while the organization is under hold',
      off.automationVersions === 0 && underHold.automationVersions === 0,
      `off=${String(off.automationVersions)}, held=${String(underHold.automationVersions)}`,
    );

    // ---- the race: a run starts on v2 while the sweep reaches it
    for (let index = 1; index <= 24; index += 1) await save(raceRun, index);
    await age(raceRun, 24);
    let release: () => void = () => undefined;
    const holdRun = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ranStarted: () => void = () => undefined;
    const runStarted = new Promise<void>((resolve) => {
      ranStarted = resolve;
    });
    const starting = sql.begin(async (tx) => {
      const started = await beginRunInTx(tx, {
        organizationId: orgId,
        name: raceRun,
        input: {},
        mode: 'mock',
        startedBy: userId,
        version: 2,
      });
      ranStarted();
      await holdRun;
      return started;
    });
    await runStarted;
    const pruning = sql.begin((tx) =>
      pruneVersions(tx, {
        organizationId: orgId,
        name: raceRun,
        cutoffMs: cutoff(),
        limit: 100,
      }),
    );
    // The sweep reaches v2's row and has to wait for the run's lock on it.
    await sleep(500);
    const early = await Promise.race([
      pruning.then(() => 'finished'),
      sleep(10).then(() => 'waiting'),
    ]);
    release();
    const [started, pruned] = await Promise.all([starting, pruning]);
    const leftRace = await versionsOf(raceRun);
    record(
      'a sweep reaching a version a run is starting on waits for the run and then keeps the version',
      early === 'waiting' &&
        started !== null &&
        !pruned.includes(2) &&
        leftRace.includes(2) &&
        pruned.length > 0,
      `early=${early}, run=${JSON.stringify(started)}, pruned=${JSON.stringify(pruned)}`,
    );

    // ---- the race the other way: the sweep holds the rows, a run starts
    for (let index = 1; index <= 24; index += 1) await save(raceSweep, index);
    await age(raceSweep, 24);
    let releaseSweep: () => void = () => undefined;
    const holdSweep = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });
    let sweepHolds: () => void = () => undefined;
    const sweepHolding = new Promise<void>((resolve) => {
      sweepHolds = resolve;
    });
    const sweeping = sql.begin(async (tx) => {
      const removed = await pruneVersions(tx, {
        organizationId: orgId,
        name: raceSweep,
        cutoffMs: cutoff(),
        limit: 100,
      });
      sweepHolds();
      await holdSweep;
      return removed;
    });
    await sweepHolding;
    const startingLate = sql.begin((tx) =>
      beginRunInTx(tx, {
        organizationId: orgId,
        name: raceSweep,
        input: {},
        mode: 'mock',
        startedBy: userId,
        version: 1,
      }),
    );
    await sleep(500);
    const lateEarly = await Promise.race([
      startingLate.then(() => 'finished'),
      sleep(10).then(() => 'waiting'),
    ]);
    releaseSweep();
    const [removedLate, late] = await Promise.all([sweeping, startingLate]);
    const runsOnV1 = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${raceSweep} AND version = 1
    `;
    record(
      'a run starting on a version the sweep is removing waits, finds it gone and starts nothing',
      lateEarly === 'waiting' &&
        removedLate.includes(1) &&
        late === null &&
        runsOnV1[0]?.n === '0',
      `early=${lateEarly}, removed=${JSON.stringify(removedLate)}, run=${JSON.stringify(late)}, runsOnV1=${runsOnV1[0]?.n}`,
    );
  } finally {
    for (const automation of automations) {
      // A run row holds its automation back from deletion: take them first,
      // the way the writer protocol asks.
      await sql
        .begin(async (tx) => {
          await markAutomationWriterInTx(tx);
          await tx`
            DELETE FROM app.automation_runs
            WHERE org_id = ${orgId} AND name = ${automation}
          `;
        })
        .catch((error: unknown) => {
          console.warn(
            `[itest] cleanup of the runs of ${automation}:`,
            error instanceof Error ? error.message : error,
          );
        });
      await deleteAutomationCascade(sql, {
        organizationId: orgId,
        name: automation,
        origin,
      }).catch((error: unknown) => {
        console.warn(
          `[itest] cleanup of ${automation}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }
}
