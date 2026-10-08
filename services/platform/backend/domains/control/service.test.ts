// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  countAutomationWork,
  drainStatus,
  isBackendDraining,
  replicaColour,
} from './service.ts';

/**
 * The regression under test: `app.backend_control` carried ONE deployment-wide
 * `draining` flag, and every api replica read it. That was right while the api
 * was a singleton rolled in place. It is wrong the moment two colours serve at
 * once — a blue-green flip starts the new colour, drains the OLD one, and
 * waits for its in-flight generations, so a deployment-wide flag makes the
 * colour that just took over refuse every chat turn for the whole drain
 * window. `draining_colour` names the target; a replica obeys only its own.
 *
 * The NULL case is load-bearing in both directions of a rolling upgrade: an
 * older CLI writes no colour and must still drain everything, and a tier that
 * is not colour-rolled has no colour to name.
 */

interface ControlRow {
  draining: boolean;
  drainExpiresAt: number | null;
  drainingColour: string | null;
}

/** A `sql` double that answers the control-row read with one row (or none). */
function sqlReturning(row: ControlRow | null): Sql {
  const tag = () => Promise.resolve(row === null ? [] : [row]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return tag as unknown as Sql;
}

const FUTURE = Date.now() + 60_000;
const PAST = Date.now() - 60_000;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('replicaColour', () => {
  it('is null outside a colour, so an uncoloured replica obeys every drain', () => {
    vi.stubEnv('TALE_COLOR', '');
    expect(replicaColour()).toBeNull();
  });

  it('reads the colour the compose file stamped on this replica', () => {
    vi.stubEnv('TALE_COLOR', 'green');
    expect(replicaColour()).toBe('green');
  });
});

describe('isBackendDraining', () => {
  it('is false with no control row at all', async () => {
    expect(await isBackendDraining(sqlReturning(null))).toBe(false);
  });

  it('is false when the flag is off', async () => {
    const sql = sqlReturning({
      draining: false,
      drainExpiresAt: FUTURE,
      drainingColour: 'blue',
    });
    expect(await isBackendDraining(sql)).toBe(false);
  });

  it('is false once the drain has expired (a deploy that died mid-drain) [CTRL-R4]', async () => {
    vi.stubEnv('TALE_COLOR', 'blue');
    const sql = sqlReturning({
      draining: true,
      drainExpiresAt: PAST,
      drainingColour: 'blue',
    });
    expect(await isBackendDraining(sql)).toBe(false);
  });

  it('drains the colour the flag names [CTRL-R3]', async () => {
    vi.stubEnv('TALE_COLOR', 'blue');
    const sql = sqlReturning({
      draining: true,
      drainExpiresAt: FUTURE,
      drainingColour: 'blue',
    });
    expect(await isBackendDraining(sql)).toBe(true);
  });

  // THE regression: without this, a flip silences the colour it just
  // promoted for the entire drain window.
  it('leaves the OTHER colour serving [CTRL-R3]', async () => {
    vi.stubEnv('TALE_COLOR', 'green');
    const sql = sqlReturning({
      draining: true,
      drainExpiresAt: FUTURE,
      drainingColour: 'blue',
    });
    expect(await isBackendDraining(sql)).toBe(false);
  });

  // An older CLI writes no colour. It means what it always meant.
  it('drains every replica when the flag names no colour [CTRL-R3]', async () => {
    vi.stubEnv('TALE_COLOR', 'green');
    const sql = sqlReturning({
      draining: true,
      drainExpiresAt: FUTURE,
      drainingColour: null,
    });
    expect(await isBackendDraining(sql)).toBe(true);
  });

  // A replica outside any colour (dev, a bare `docker compose up`) is the
  // only api there is, so "drain blue" can only have meant it.
  it('drains an uncoloured replica whatever colour the flag names [CTRL-R3]', async () => {
    vi.stubEnv('TALE_COLOR', '');
    const sql = sqlReturning({
      draining: true,
      drainExpiresAt: FUTURE,
      drainingColour: 'blue',
    });
    expect(await isBackendDraining(sql)).toBe(true);
  });

  it('treats a null expiry as unbounded rather than stale', async () => {
    vi.stubEnv('TALE_COLOR', 'blue');
    const sql = sqlReturning({
      draining: true,
      drainExpiresAt: null,
      drainingColour: 'blue',
    });
    expect(await isBackendDraining(sql)).toBe(true);
  });
});

/** A `sql` double that answers each statement by what it reads, and keeps
 * every statement it was given. */
function sqlByStatement(answers: {
  drain?: { startedAt: number | null; colour: string | null } | null;
  runs?: number;
  drives?: number;
  generations?: number;
}) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('drain_started_at_ms::float8 AS "startedAt"')) {
      return Promise.resolve(answers.drain ? [answers.drain] : []);
    }
    if (text.includes('FROM app.automation_runs')) {
      return Promise.resolve([{ count: answers.runs ?? 0 }]);
    }
    if (text.includes('FROM pgboss.job')) {
      return Promise.resolve([{ count: answers.drives ?? 0 }]);
    }
    if (text.includes('FROM app.generations')) {
      return Promise.resolve([{ count: String(answers.generations ?? 0) }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, statements };
}

describe('the automation work a drain waits for [CTRL-R5]', () => {
  it('is nothing while no drain is active', async () => {
    const { sql, statements } = sqlByStatement({ drain: null, runs: 4 });

    expect(await countAutomationWork(sql)).toEqual({
      automationRuns: 0,
      agentDrives: 0,
    });
    expect(
      statements.some((s) => s.text.includes('FROM app.automation_runs')),
    ).toBe(false);
  });

  it('counts the runs the drained colour is stepping, and the drives that began before the drain', async () => {
    const { sql, statements } = sqlByStatement({
      drain: { startedAt: 1_000_000, colour: 'blue' },
      runs: 2,
      drives: 1,
    });

    expect(await countAutomationWork(sql)).toEqual({
      automationRuns: 2,
      agentDrives: 1,
    });
    const runs = statements.find((s) =>
      s.text.includes('FROM app.automation_runs'),
    );
    // Only live leases, and only those whose owner names the colour.
    expect(runs?.text).toContain('lease_expires_at_ms >');
    expect(runs?.text).toContain("substring(lease_owner from '[^:]*$')");
    expect(runs?.values).toContain('blue');
    const drives = statements.find((s) => s.text.includes('FROM pgboss.job'));
    expect(drives?.text).toContain("state = 'active'");
    expect(drives?.values).toContain('automation.v2.agent_drive');
    expect(drives?.text).toContain("'automation.agent_drive'");
    expect(drives?.text).toContain("'task.agent_drive'");
    expect(drives?.values).toContain(1_000_000);
  });

  it('counts every colour when the drain names none', async () => {
    const { sql, statements } = sqlByStatement({
      drain: { startedAt: 5, colour: null },
      runs: 3,
    });

    await countAutomationWork(sql);
    const runs = statements.find((s) =>
      s.text.includes('FROM app.automation_runs'),
    );
    expect(runs?.values).toContain(null);
  });

  it('adds the automation work to what an older CLI reads as in flight', async () => {
    vi.stubEnv('TALE_COLOR', 'blue');
    const { sql } = sqlByStatement({
      drain: { startedAt: 5, colour: 'blue' },
      runs: 2,
      drives: 1,
      generations: 3,
    });

    expect(await drainStatus(sql)).toMatchObject({
      inFlight: 6,
      generations: 3,
      automationRuns: 2,
      agentDrives: 1,
      colour: 'blue',
    });
  });
});
