// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isBackendDraining, replicaColour } from './service.ts';

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

  it('is false once the drain has expired (a deploy that died mid-drain)', async () => {
    vi.stubEnv('TALE_COLOR', 'blue');
    const sql = sqlReturning({
      draining: true,
      drainExpiresAt: PAST,
      drainingColour: 'blue',
    });
    expect(await isBackendDraining(sql)).toBe(false);
  });

  it('drains the colour the flag names', async () => {
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
  it('leaves the OTHER colour serving', async () => {
    vi.stubEnv('TALE_COLOR', 'green');
    const sql = sqlReturning({
      draining: true,
      drainExpiresAt: FUTURE,
      drainingColour: 'blue',
    });
    expect(await isBackendDraining(sql)).toBe(false);
  });

  // An older CLI writes no colour. It means what it always meant.
  it('drains every replica when the flag names no colour', async () => {
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
  it('drains an uncoloured replica whatever colour the flag names', async () => {
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
