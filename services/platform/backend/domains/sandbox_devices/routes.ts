import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  createJoinToken,
  getJoinTokenStatus,
  listDevices,
  removeDevice,
  SandboxDeviceError,
  type SandboxDeviceActor,
} from './service.ts';

/**
 * /api/app/sandbox-devices — the Devices section of Settings → Sandboxes.
 * Admins and developers see the organization's devices (the capacity cards'
 * audience); adding and removing one is the `orgSettings` write ability,
 * because a device runs the organization's sandboxes — its workspaces,
 * files and per-session credentials — on hardware its owner controls. The
 * machines themselves talk to the door at `/api/sandbox-devices`
 * (door-routes.ts).
 */

function refusal(c: Context<OrgEnv>, error: unknown): Response {
  if (error instanceof SandboxDeviceError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  throw error;
}

export function createSandboxDeviceRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const refuseUnlessAdmin = (c: Context<OrgEnv>): Response | null =>
    defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
      ? c.json(
          { error: 'Only admins can manage devices', code: 'ROLE_FORBIDDEN' },
          403,
        )
      : null;
  const actor = (c: Context<OrgEnv>): SandboxDeviceActor => ({
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
  });

  /** The list: every live device, merged with what the hub sees now. */
  app.get('/', async (c) => {
    if (!isAdminOrDeveloperRole(c.get('orgMember').role)) {
      return c.json(
        { error: 'developer role required', code: 'ROLE_FORBIDDEN' },
        403,
      );
    }
    c.header('Cache-Control', 'no-store');
    return c.json(await listDevices(deps.sql, c.get('orgId')));
  });

  /** "Add device": the join token the one-line command carries. The token is
   * in THIS answer and nowhere else. */
  app.post('/join-tokens', async (c) => {
    const refused = refuseUnlessAdmin(c);
    if (refused) return refused;
    c.header('Cache-Control', 'no-store');
    try {
      return c.json(
        await createJoinToken(deps.sql, {
          organizationId: c.get('orgId'),
          actor: actor(c),
        }),
        201,
      );
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get('/join-tokens/:tokenId', async (c) => {
    const refused = refuseUnlessAdmin(c);
    if (refused) return refused;
    c.header('Cache-Control', 'no-store');
    try {
      return c.json(
        await getJoinTokenStatus(deps.sql, {
          organizationId: c.get('orgId'),
          tokenId: c.req.param('tokenId'),
          actor: actor(c),
        }),
      );
    } catch (error) {
      return refusal(c, error);
    }
  });

  /** Remove a device: its secret stops working and its tunnel is cut. */
  app.delete('/:deviceId', async (c) => {
    const refused = refuseUnlessAdmin(c);
    if (refused) return refused;
    try {
      await removeDevice(deps.sql, {
        organizationId: c.get('orgId'),
        deviceId: c.req.param('deviceId'),
        actor: actor(c),
      });
      return c.json({ removed: true });
    } catch (error) {
      return refusal(c, error);
    }
  });

  return app;
}
