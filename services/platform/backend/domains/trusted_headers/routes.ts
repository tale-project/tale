import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import {
  trustedHeaderKeyCreateSchema,
  trustedHeaderSettingsInputSchema,
} from '../../../lib/shared/schemas/trusted_headers.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  createTrustedHeaderKey,
  getTrustedHeadersView,
  revokeTrustedHeaderKey,
  setTrustedHeaderSettings,
  TrustedHeadersError,
  type TrustedHeadersActor,
} from './service.ts';

/**
 * /api/app/trusted-headers — the admin settings surface behind the
 * trusted-headers card: the organization's switch and role ceiling, and its
 * keys (minted here, plaintext answered once, revoked by a stamp). Every
 * verb is the `orgSettings` ability — the same gate as Enterprise SSO and
 * the SCIM token — because a key here signs members in as whoever the
 * proxy names. The hand-off door itself lives unauthenticated at
 * `/api/trusted-headers` (`domains/sso/trusted-headers.ts`).
 */

function refusal(c: Context<OrgEnv>, error: unknown): Response {
  if (error instanceof TrustedHeadersError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  throw error;
}

export function createTrustedHeaderAdminRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const refuseUnlessAdmin = (c: Context<OrgEnv>): Response | null => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
    ) {
      return c.json(
        {
          error: 'Only admins can manage trusted headers',
          code: 'ROLE_FORBIDDEN',
        },
        403,
      );
    }
    return null;
  };
  const actor = (c: Context<OrgEnv>): TrustedHeadersActor => ({
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
  });

  /** The card's read: switch, ceiling, live keys, effective header names. */
  app.get('/', async (c) => {
    const refused = refuseUnlessAdmin(c);
    if (refused) return refused;
    return c.json(await getTrustedHeadersView(deps.sql, c.get('orgId')));
  });

  /** Flip the switch and/or move the ceiling. */
  app.put('/settings', async (c) => {
    const refused = refuseUnlessAdmin(c);
    if (refused) return refused;
    const body = trustedHeaderSettingsInputSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        {
          error:
            'Invalid trusted-headers settings: expected {enabled: boolean, maxAssertedRole: member|editor|developer|admin}',
          code: 'INVALID_BODY',
        },
        400,
      );
    }
    return c.json(
      await setTrustedHeaderSettings(deps.sql, {
        organizationId: c.get('orgId'),
        actor: actor(c),
        enabled: body.data.enabled,
        maxAssertedRole: body.data.maxAssertedRole,
      }),
    );
  });

  /** Mint a key — the plaintext is in THIS answer and nowhere else. */
  app.post('/keys', async (c) => {
    const refused = refuseUnlessAdmin(c);
    if (refused) return refused;
    const body = trustedHeaderKeyCreateSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        {
          error: 'Invalid trusted-header key: expected {name: string}',
          code: 'INVALID_BODY',
        },
        400,
      );
    }
    try {
      const created = await createTrustedHeaderKey(deps.sql, {
        organizationId: c.get('orgId'),
        actor: actor(c),
        name: body.data.name,
      });
      return c.json(created, 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  /** Revoke a key: a stamp, and a second revoke is a no-op. */
  app.delete('/keys/:id', async (c) => {
    const refused = refuseUnlessAdmin(c);
    if (refused) return refused;
    try {
      await revokeTrustedHeaderKey(deps.sql, {
        organizationId: c.get('orgId'),
        actor: actor(c),
        keyId: c.req.param('id'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return refusal(c, error);
    }
  });

  return app;
}
