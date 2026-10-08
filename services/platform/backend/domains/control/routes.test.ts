// @vitest-environment node

/**
 * The control door is the deployment's own machine door: `tale deploy`,
 * `tale migrate` and `tale auth reset-owner` reach it with the control
 * token and nothing else. Without a configured token the door does not
 * exist, and with one every call must present it.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createControlRoutes } from './routes.ts';

/** A `sql` double that answers every read with no rows: nothing drains and
 * nothing is in flight. */
function emptySql(): Sql {
  const tag = () => Promise.resolve([]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return tag as unknown as Sql;
}

const TOKEN = 'control-token-for-tests';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the control door', () => {
  it('does not exist on a deployment without a control token [CTRL-R1]', async () => {
    vi.stubEnv('TALE_CONTROL_TOKEN', '');
    const app = createControlRoutes({ sql: emptySql() });
    const res = await app.request('/drain-status', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['no token', undefined],
    ['another token', 'Bearer not-the-token'],
    ['the token without the Bearer scheme', TOKEN],
  ])('refuses a call with %s [CTRL-R2]', async (_label, authorization) => {
    vi.stubEnv('TALE_CONTROL_TOKEN', TOKEN);
    const app = createControlRoutes({ sql: emptySql() });
    const res = await app.request('/drain-status', {
      headers: authorization === undefined ? {} : { authorization },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('answers a call that presents the token [CTRL-R2]', async () => {
    vi.stubEnv('TALE_CONTROL_TOKEN', TOKEN);
    vi.stubEnv('TALE_COLOR', '');
    const app = createControlRoutes({ sql: emptySql() });
    const res = await app.request('/drain-status', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      draining: false,
      inFlight: 0,
      generations: 0,
      automationRuns: 0,
      agentDrives: 0,
      colour: null,
    });
  });
});
