// Many creates at once, over and over, against a spawner whose warm pool is on:
// what production does all day and the other suites do a few times. Every
// round creates a burst of sessions together (some claimed from the pool, some
// cold), runs a command in each, and destroys them together, so that starts,
// claims, refills and removals overlap on the node. A create that fails, or
// that an instance without an address makes wait out its budget, is a finding;
// the timings say how the node behaves while it is busy.
//
// The number of rounds is `INCUS_E2E_SOAK_ROUNDS` (default 6, a minute or two;
// the dispatch's `soak_rounds` raises it to hunt for something rare).

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import { LABEL, label } from '../../../src/backend/incus/incus-naming.ts';
import {
  admin,
  reportFor,
  sessionId,
  spawnerOf,
  step,
  until,
} from '../harness.ts';
import { formatDuration } from '../report.ts';
import { newToken } from '../spawner.ts';

const report = reportFor('soak');
const ROUNDS = (() => {
  const raw = (process.env.INCUS_E2E_SOAK_ROUNDS ?? '').trim() || '6';
  const rounds = Number(raw);
  // A number nobody meant would make the suite pass without running a round.
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 500) {
    throw new Error(
      `INCUS_E2E_SOAK_ROUNDS must be a whole number from 1 to 500, not ${JSON.stringify(raw)}`,
    );
  }
  return rounds;
})();
const BURST = 8;
const POOL_SIZE = 3;
const spawner = spawnerOf({
  name: 'soak',
  port: 18070,
  token: newToken(),
  env: {
    SANDBOX_MAX_SESSIONS: String(BURST + POOL_SIZE + 1),
    SANDBOX_INCUS_POOL_SIZE: String(POOL_SIZE),
    // A create that hangs fails after this, with the node dumped at 40 s.
    SANDBOX_SESSION_CREATE_TIMEOUT_MS: '90000',
  },
});
const api = spawner.api;
const ORG = 'e2e-soak';

const elapsed: number[] = [];
let failures = 0;
/** How many leases the DHCP server held after each round. */
const leases: number[] = [];
/** What went wrong, round by round. */
const problems: string[] = [];

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index] ?? 0;
}

describe('creates at once, over and over', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    spawner.start();
    await spawner.ready({ image: true });
  }, 40 * 60_000);

  afterAll(async () => {
    await spawner.stop();
    await admin.cleanSlate();
    report.flush();
  });

  step(
    `${ROUNDS} rounds of ${BURST} creates at once, each answered and destroyed`,
    async () => {
      // Standbys first: the first burst should find the pool full.
      await until(
        'the pool to fill',
        async () =>
          (await admin.instances()).filter(
            (instance) =>
              label(instance.config, LABEL.pool) !== undefined &&
              instance.status === 'Running',
          ).length >= POOL_SIZE,
        { timeoutMs: 5 * 60_000, intervalMs: 1_000 },
      );
      for (let round = 1; round <= ROUNDS; round += 1) {
        const ids = Array.from({ length: BURST }, () => sessionId('soak'));
        const started = performance.now();
        const results = await Promise.all(
          ids.map((id, index) =>
            api.create({
              sessionId: id,
              organizationId: ORG,
              // The pool serves the agent shape; the light one starts cold.
              profile: index % 2 === 0 ? 'agent' : 'agent-light',
            }),
          ),
        );
        const wall = performance.now() - started;
        const bad = results.filter((result) => result.reply.status !== 201);
        failures += bad.length;
        for (const result of results) elapsed.push(result.elapsedMs);
        report.add(
          `round ${round}: ${BURST} creates at once (wall time)`,
          wall,
          results
            .map((result) =>
              result.reply.status === 201
                ? `${Math.round(result.elapsedMs)} ms`
                : `HTTP ${result.reply.status}`,
            )
            .join(', '),
        );
        // Every session that was made answers, and the rest are destroyed
        // whatever happened to a sibling.
        const answered = await Promise.all(
          ids.map(async (id, index) => {
            if (results[index]?.reply.status !== 201) return 'not created';
            const outcome = await api.exec(id, {
              shell: 'echo ok',
              timeoutMs: 30_000,
            });
            return outcome.stdout.trim();
          }),
        );
        const destroyed = await Promise.all(ids.map((id) => api.destroy(id)));
        // A finding does not stop the rounds: the hunt wants every one.
        for (const result of bad) {
          problems.push(
            `round ${round}: a create answered HTTP ${result.reply.status} after ${formatDuration(result.elapsedMs)}: ${result.reply.text.slice(0, 300)}`,
          );
        }
        for (const [index, answer] of answered.entries()) {
          if (answer !== 'ok' && answer !== 'not created') {
            problems.push(
              `round ${round}: ${ids[index]} answered ${JSON.stringify(answer)}`,
            );
          }
        }
        for (const [index, reply] of destroyed.entries()) {
          if (reply.status !== 200) {
            problems.push(
              `round ${round}: destroying ${ids[index]} answered HTTP ${reply.status}`,
            );
          }
        }
        leases.push((await admin.leases()).length);
      }
      expect(problems).toEqual([]);
    },
  );

  step(
    'the node is left as clean as it was found, standbys aside',
    async () => {
      const sessions = (await admin.instances()).filter(
        (instance) => label(instance.config, LABEL.session) !== undefined,
      );
      const volumes = await admin.volumes();
      const sorted = [...elapsed].sort((a, b) => a - b);
      report.fact(
        'creates',
        `${sorted.length} in ${ROUNDS} rounds, ${failures} failed`,
      );
      report.fact(
        'create time under load',
        `p50 ${formatDuration(percentile(sorted, 0.5))}, p90 ${formatDuration(percentile(sorted, 0.9))}, max ${formatDuration(sorted.at(-1) ?? 0)}`,
      );
      report.add('slowest create under load', sorted.at(-1) ?? 0);
      report.fact(
        'DHCP leases held after each round',
        leases.length === 0 ? 'none read' : leases.join(' '),
      );
      expect(sessions.map((instance) => instance.name)).toEqual([]);
      expect(volumes.map((volume) => volume.name)).toEqual([]);
    },
  );
});
