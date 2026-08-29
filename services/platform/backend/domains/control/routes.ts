import { timingSafeEqual } from 'node:crypto';

import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import {
  beginDrain,
  drainStatus,
  endDrain,
  provisionAllOrganizations,
} from './service.ts';

/**
 * /api/control — the deploy-time machine door (`tale deploy` drains chat
 * turns before recreating the backend). Authenticated by the deployment's
 * own control token: the bearer must equal `TALE_CONTROL_TOKEN`
 * (constant-time compare). With the env unset the door does not exist
 * (plain 404) — fail-closed, and the CLI's drain is best-effort by design,
 * so a missing door degrades to "skip the drain and proceed".
 */

function controlTokenMatches(c: Context): boolean {
  const configured = process.env.TALE_CONTROL_TOKEN;
  if (!configured) return false;
  const header = c.req.header('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (presented.length === 0) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createControlRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.use(async (c, next) => {
    if (!process.env.TALE_CONTROL_TOKEN) {
      // The door is not configured on this deployment — it does not exist.
      return c.json({ error: 'not found' }, 404);
    }
    if (!controlTokenMatches(c)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
    return undefined;
  });

  app.post('/drain', async (c) => {
    return c.json(await beginDrain(deps.sql));
  });

  app.post('/end-drain', async (c) => {
    await endDrain(deps.sql);
    return c.json({ ok: true });
  });

  app.get('/drain-status', async (c) => {
    return c.json(await drainStatus(deps.sql));
  });

  /** `tale migrate` — re-seed every org's provisioned content (idempotent).
   * Schema migrations are not here on purpose: the backend applies them at
   * boot under its advisory lock. */
  app.post('/provision', async (c) => {
    return c.json(await provisionAllOrganizations(deps.sql));
  });

  return app;
}
