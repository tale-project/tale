import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { loadTrustedProxies, type Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  getClientIp,
  nodePeerAddress,
} from '../../core/lib/utils/client_ip.ts';
import { invalidBodyResponse } from '../../lib/invalid-body-response.ts';
import { SERVICE_KEY_ROLES } from './owners.ts';
import {
  type ApiKeyActor,
  ApiKeyError,
  createOwnedApiKey,
  listApiKeysForViewer,
  revokeBoundApiKey,
} from './service.ts';

/**
 * /api/app/api-keys — the API keys a person sees in one organization, and
 * the keys an Owner or Admin makes for others there.
 *
 *  - `GET /` lists the caller's own keys (which work in every organization
 *    they belong to), the keys made for them here and, for an Owner or
 *    Admin, every key bound to this organization.
 *  - `POST /` makes a key for another member, a team, a project or the
 *    organization (Owners and Admins). A person's own key is still made at
 *    the api-key plugin's `/api/auth/api-key/create`, behind its create gate.
 *  - `DELETE /:keyId` ends a key bound to this organization. A person's own
 *    key is ended at the plugin's `/api/auth/api-key/delete`.
 */

const ownerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), userId: z.string().min(1).max(128) }),
  z.object({
    kind: z.literal('team'),
    teamId: z.string().min(1).max(128),
    role: z.enum(SERVICE_KEY_ROLES),
  }),
  z.object({
    kind: z.literal('project'),
    projectId: z.string().min(1).max(128),
    role: z.enum(SERVICE_KEY_ROLES),
  }),
  z.object({
    kind: z.literal('organization'),
    role: z.enum(SERVICE_KEY_ROLES),
  }),
]);

const createBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    /** Seconds, whole days from one to 365; absent for a key that never
     * expires. */
    expiresIn: z.number().int().positive().optional(),
    owner: ownerSchema,
  })
  .strict();

export function createApiKeyRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  /** The signed-in member acting here, as the audit rows name them. */
  const actorOf = async (c: Context<OrgEnv>): Promise<ApiKeyActor> => {
    const user = c.get('sessionBundle').user;
    const ip = getClientIp(c.req.raw.headers, await loadTrustedProxies(), {
      peer: nodePeerAddress(c.env),
    });
    const userAgent = c.req.header('user-agent');
    return {
      userId: user.id,
      ...(user.email ? { email: user.email } : {}),
      ...(user.name ? { name: user.name } : {}),
      role: c.get('orgMember').role,
      ...(ip !== 'unknown' ? { ip } : {}),
      ...(userAgent !== undefined ? { userAgent } : {}),
    };
  };

  const refusal = (c: Context<OrgEnv>, error: unknown): Response => {
    if (error instanceof ApiKeyError) {
      return c.json(
        { error: error.code, message: error.message },
        error.status,
      );
    }
    throw error;
  };

  app.get('/', async (c) => {
    return c.json({
      keys: await listApiKeysForViewer(deps.sql, {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
      }),
    });
  });

  app.post('/', async (c) => {
    // The door's reader answers a body that is not JSON (`app-json-body.ts`).
    const body = createBodySchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const created = await createOwnedApiKey(deps, {
        organizationId: c.get('orgId'),
        actor: await actorOf(c),
        name: body.data.name,
        ...(body.data.expiresIn !== undefined
          ? { expiresIn: body.data.expiresIn }
          : {}),
        owner: body.data.owner,
      });
      return c.json(
        {
          id: created.id,
          key: created.key,
          name: created.name,
          expiresAt: created.expiresAt,
        },
        201,
      );
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.delete('/:keyId', async (c) => {
    try {
      await revokeBoundApiKey(deps, {
        organizationId: c.get('orgId'),
        actor: await actorOf(c),
        keyId: c.req.param('keyId'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return refusal(c, error);
    }
  });

  return app;
}
