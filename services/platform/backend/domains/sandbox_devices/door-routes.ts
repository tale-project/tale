import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import {
  sandboxDeviceJoinSchema,
  sandboxDeviceTicketRequestSchema,
} from '../../../lib/shared/schemas/sandbox-devices.ts';
import { loadTrustedProxies } from '../../auth/auth.ts';
import {
  getClientIp,
  nodePeerAddress,
} from '../../core/lib/utils/client_ip.ts';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import {
  describeDevice,
  grantTicket,
  joinDevice,
  leaveDevice,
  SandboxDeviceError,
} from './service.ts';

/**
 * /api/sandbox-devices — the machine door a connected device (and the CLI
 * connecting it) talks to. No browser session: the join token or the device
 * secret IS the credential, and the organization is resolved from it.
 *
 *   POST   /join     `tale sandbox connect` trades a join token for the
 *                    device's own secret (answered once).
 *   POST   /ticket   the device's spawner, every few minutes: report what it
 *                    runs, receive a short-lived connect ticket for the hub.
 *   GET    /self     `tale sandbox status`: which organization, connected?
 *   DELETE /self     `tale sandbox disconnect`: the device removes itself.
 *
 * A credential that matches nothing is charged to its source IP before the
 * answer — the trusted-headers and REST doors' posture.
 */

function bearer(c: Context): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
  return match?.[1] ?? null;
}

export function createSandboxDeviceDoorRoutes(deps: {
  sql: Sql;
  trustedProxies?: () => Promise<string[]>;
}): Hono {
  const app = new Hono();
  const trustedProxies = deps.trustedProxies ?? loadTrustedProxies;

  /** The client the trusted-proxy walk vouches for — from the TCP peer when
   * the runtime exposes it, never the caller's leftmost XFF entry. */
  async function clientIp(c: Context): Promise<string> {
    return getClientIp(c.req.raw.headers, await trustedProxies(), {
      peer: nodePeerAddress(c.env),
    });
  }

  /** Map a refusal to its answer; an unknown credential is charged first. */
  async function refuse(c: Context, error: unknown): Promise<Response> {
    if (!(error instanceof SandboxDeviceError)) throw error;
    if (error.status === 401) {
      try {
        await checkIpRateLimit(
          deps.sql,
          'sandbox-devices:auth-fail-ip',
          await clientIp(c),
        );
      } catch (limit) {
        if (limit instanceof RateLimitExceededError) {
          return c.json(
            { error: 'Too many attempts; retry later', code: 'RATE_LIMITED' },
            429,
          );
        }
        throw limit;
      }
    }
    return c.json({ error: error.message, code: error.code }, error.status);
  }

  // Not DEVICE_REVOKED: a proxy that strips the header must not read as
  // "the organization removed this device" (which parks a device for hours).
  const missingCredential = (): SandboxDeviceError =>
    new SandboxDeviceError(
      'DEVICE_CREDENTIAL_MISSING',
      'Present the device secret as `Authorization: Bearer tsd_…`',
      401,
    );

  app.post('/join', async (c) => {
    const body = sandboxDeviceJoinSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        {
          error:
            'Invalid join request: expected {token, name, maxSessions, platform: {os, arch}}',
          code: 'INVALID_BODY',
        },
        400,
      );
    }
    c.header('Cache-Control', 'no-store');
    try {
      return c.json(await joinDevice(deps.sql, body.data), 201);
    } catch (error) {
      return refuse(c, error);
    }
  });

  app.post('/ticket', async (c) => {
    const secret = bearer(c);
    if (secret === null) return refuse(c, missingCredential());
    const body = sandboxDeviceTicketRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        {
          error:
            'Invalid ticket request: expected {version, maxSessions?, platform?}',
          code: 'INVALID_BODY',
        },
        400,
      );
    }
    c.header('Cache-Control', 'no-store');
    try {
      return c.json(await grantTicket(deps.sql, secret, body.data));
    } catch (error) {
      return refuse(c, error);
    }
  });

  app.get('/self', async (c) => {
    const secret = bearer(c);
    if (secret === null) return refuse(c, missingCredential());
    c.header('Cache-Control', 'no-store');
    try {
      return c.json(await describeDevice(deps.sql, secret));
    } catch (error) {
      return refuse(c, error);
    }
  });

  app.delete('/self', async (c) => {
    const secret = bearer(c);
    if (secret === null) return refuse(c, missingCredential());
    try {
      await leaveDevice(deps.sql, secret);
      return c.json({ removed: true });
    } catch (error) {
      return refuse(c, error);
    }
  });

  return app;
}
