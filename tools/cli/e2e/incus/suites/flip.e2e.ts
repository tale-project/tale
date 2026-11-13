// flip: twenty colour flips of a workspace on Incus under load sent through
// main's edge (the proxy) in front of the switch — HTTP to the platform and
// the backend, the backend's server-sent event streams, a 1 Hz /api/health
// poller, and a sandbox session calling the backend by its stable name — and
// not one failure (design 7.3, 15.5, R3-02, R3-21). A failure is a 5xx, an
// edge 502/503/504, the maintenance page or UPSTREAM_UNAVAILABLE. Each answer
// is attributed by its serving identity: once the old colour's withdrawal
// window has passed, it serves nothing new. A stream ends only at the old
// colour's retirement, never before it, and the client's reconnect lands on
// a serving replica at once.
//
// Main's switched roles serve no WebSocket (0.5 replaced the Convex socket
// with HTTP and the `/events` hint stream); the edge's one WebSocket lane,
// `/sandbox/tunnel`, reaches the spawner, which a flip never touches. The
// streams this suite holds are therefore server-sent events.

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { SpawnerApi } from '../../../../../services/sandbox/e2e/incus/spawner-api';
import { record, until } from '../harness';
import {
  attributedLoad,
  colourOf,
  edgeOf,
  loadWorkspace,
  openStream,
  relayThroughSpawner,
  runningRelease,
  sandboxToken,
  SESSION_LOAD,
  sessionVerdict,
  stalls,
  viaEdge,
  visitor,
  watched,
  WITHDRAWAL_WINDOW_MS,
  workspaceDeployed,
  type Stream,
} from '../workspace';

setDefaultTimeout(4 * 60 * 60_000);
const w = loadWorkspace();
const FLIPS = Number(process.env.TALE_E2E_FLIPS ?? '20');
const STREAMS_PER_FLIP = 4;
const SESSION = `e2e-flip-${randomUUID().slice(0, 8)}`;

const direct = globalThis.fetch;
let spawner: SpawnerApi | undefined;
afterAll(async () => {
  if (spawner === undefined) return;
  globalThis.fetch = relayThroughSpawner(w);
  try {
    await spawner.destroy(SESSION);
  } catch (error) {
    console.warn('flip: the session was not destroyed:', error);
  } finally {
    globalThis.fetch = direct;
  }
});

describe('flip', () => {
  test(`${FLIPS} flips under HTTP, stream and session load through the edge: no failure`, async () => {
    await workspaceDeployed(w);
    const who = await visitor(w, 'flip');
    const edge = edgeOf(w);
    // Each flip redeploys the release the workspace runs.
    const release = runningRelease(w);
    const epoch = performance.now();

    // A session of the stack's own spawner calls the backend through its
    // stable name (the switch) while each flip runs: one exec per flip,
    // since the spawner bounds an exec (SANDBOX_MAX_TIMEOUT_MS, 5 min).
    spawner = new SpawnerApi('http://sandbox:8003', sandboxToken(w));
    const api = spawner;
    globalThis.fetch = relayThroughSpawner(w);
    try {
      await until(
        'the spawner to answer',
        async () => (await api.health()).status === 200,
        { timeoutMs: 5 * 60_000, intervalMs: 3_000 },
      );
      const created = await api.create({
        sessionId: SESSION,
        organizationId: who.organization,
      });
      expect(created.reply.status).toBe(201);
    } finally {
      globalThis.fetch = direct;
    }
    /** Start the session's calls; the exec's request leaves at once (the
     * relay is swapped in for the call alone), and the pollers fetch
     * directly. */
    const startSession = (): Promise<string> => {
      globalThis.fetch = relayThroughSpawner(w, 10 * 60);
      try {
        return api
          .exec(SESSION, {
            command: ['bash', '-c', SESSION_LOAD],
            timeoutMs: 4 * 60_000,
            clientTimeoutMs: 6 * 60_000,
            collectOutput: true,
          })
          .then((outcome) => outcome.stdout);
      } finally {
        globalThis.fetch = direct;
      }
    };
    /** Stop the session's calls and read what they saw. The relay is
     * swapped in for the call alone, never across an await: the pollers
     * would send through it. */
    const stopSession = async (running: Promise<string>) => {
      globalThis.fetch = relayThroughSpawner(w);
      let stopped: Promise<unknown>;
      try {
        stopped = api.exec(SESSION, {
          command: ['touch', '/tmp/e2e-stop'],
          timeoutMs: 60_000,
          collectOutput: true,
        });
      } finally {
        globalThis.fetch = direct;
      }
      await stopped;
      return sessionVerdict(await running);
    };
    const sessions: ReturnType<typeof sessionVerdict>[] = [];

    const load = attributedLoad(
      [
        { name: 'platform', ...viaEdge(w, '/api/health', edge) },
        { name: 'backend', ...viaEdge(w, '/api/health/ready', edge) },
        { name: 'web', ...viaEdge(w, '/', edge) },
      ],
      { intervalMs: 50, epoch },
    );
    const poller = attributedLoad(
      [{ name: 'health-1hz', ...viaEdge(w, '/api/health', edge) }],
      { intervalMs: 1_000, epoch },
    );

    const flips: {
      from: string | null;
      to: string | null;
      ms: number;
      phases: Record<string, number>;
      lateOld: number;
      earlyDrops: string[];
      reconnects: number;
    }[] = [];
    const failures: string[] = [];
    let streams: Stream[] = [];
    for (let flip = 1; flip <= FLIPS; flip += 1) {
      // Only the serving colour answers now: what serves in these seconds
      // is the colour the flip retires.
      const quietFrom = performance.now() - epoch;
      streams = Array.from({ length: STREAMS_PER_FLIP }, (_, index) =>
        openStream(w, who, `flip ${flip} stream ${index}`, epoch, edge),
      );
      await Bun.sleep(3_000);
      const quietTo = performance.now() - epoch;
      const old = new Set(
        load.answers
          .filter(
            (answer) =>
              answer.at >= quietFrom &&
              answer.at < quietTo &&
              answer.identity !== null,
          )
          .map((answer) => answer.identity as string),
      );
      // With no identity seen, the late-request check below proves nothing.
      if (old.size === 0)
        failures.push(
          `flip ${flip}: no answer carried a serving identity before the flip`,
        );
      const from = colourOf(w);
      const session = startSession();
      const started = performance.now();
      const { run, phases } = await watched(
        w,
        ['deploy', '--yes', '--skip-backup'],
        epoch,
        { release },
      );
      if (run.code !== 0)
        throw new Error(
          `flip ${flip}: tale deploy exited ${run.code}:\n${run.stdout.slice(-3000)}\n${run.stderr.slice(-3000)}`,
        );
      const ended = performance.now() - epoch;
      await Bun.sleep(2_000);
      sessions.push(await stopSession(session));
      const retiring = phases.retiring;
      if (retiring === undefined)
        failures.push(
          `flip ${flip}: the journal never showed its retiring phase`,
        );
      const cut = (retiring ?? 0) + WITHDRAWAL_WINDOW_MS;
      const lateOld = load.answers.filter(
        (answer) =>
          answer.at > cut &&
          answer.at <= ended &&
          answer.identity !== null &&
          old.has(answer.identity),
      ).length;
      if (lateOld > 0)
        failures.push(
          `flip ${flip}: the retired colour served ${lateOld} new requests after its withdrawal window`,
        );
      // A stream may end at the old colour's retirement, never before it.
      const earlyDrops = streams
        .filter(
          (stream) =>
            stream.endedAt !== null &&
            (stream.openedAt === null ||
              stream.endedAt < (retiring ?? Number.POSITIVE_INFINITY)),
        )
        .map((stream) => `${stream.label}: ${stream.ending}`);
      failures.push(...earlyDrops.map((drop) => `flip ${flip}: ${drop}`));
      // Every client whose stream ended reconnects, and lands on a replica
      // that serves.
      const dropped = streams.filter((stream) => stream.endedAt !== null);
      const again = dropped.map((stream) =>
        openStream(w, who, `${stream.label} reconnect`, epoch, edge),
      );
      await until(
        `flip ${flip}: the reconnects to open`,
        () =>
          again.every(
            (stream) => stream.openedAt !== null || stream.endedAt !== null,
          ),
        { timeoutMs: 30_000, intervalMs: 200 },
      ).catch((error: unknown) => {
        failures.push(`flip ${flip}: ${String(error)}`);
      });
      for (const stream of again)
        if (stream.openedAt === null)
          failures.push(
            `flip ${flip}: ${stream.label} did not open (${stream.ending})`,
          );
      for (const stream of [...streams, ...again]) stream.close();
      flips.push({
        from,
        to: colourOf(w),
        ms: Math.round(performance.now() - started),
        phases: Object.fromEntries(
          Object.entries(phases).map(([phase, at]) => [phase, Math.round(at)]),
        ),
        lateOld,
        earlyDrops,
        reconnects: again.filter((stream) => stream.openedAt !== null).length,
      });
      if (flips.at(-1)?.from === flips.at(-1)?.to)
        failures.push(`flip ${flip}: the serving colour did not change`);
    }

    const answers = await load.stop();
    const health = await poller.stop();
    const verdict = {
      ok: sessions.reduce((sum, one) => sum + one.ok, 0),
      fail: sessions.reduce((sum, one) => sum + Math.max(one.fail, 0), 0),
      unfinished: sessions.filter((one) => one.fail < 0).length,
      failures: sessions.flatMap((one) => one.failures).slice(0, 40),
    };
    const failed = [...answers, ...health].filter((answer) => !answer.ok);
    record(w.lab, 'flip', {
      flips,
      requests: answers.length,
      failedRequests: failed.length,
      failedSamples: failed.slice(0, 40),
      stalls: [...stalls(answers), ...stalls(health)],
      healthPolls: health.length,
      session: verdict,
      websocket:
        'none: the switched roles serve no WebSocket on main; the streams are SSE (/events)',
    });

    expect(flips).toHaveLength(FLIPS);
    expect(failures).toEqual([]);
    expect(failed).toEqual([]);
    expect([...stalls(answers), ...stalls(health)]).toEqual([]);
    expect(health.length).toBeGreaterThan(FLIPS * 10);
    expect(sessions).toHaveLength(FLIPS);
    expect(verdict.unfinished).toBe(0);
    expect(verdict.fail).toBe(0);
    expect(verdict.ok).toBeGreaterThan(0);
  });
});
