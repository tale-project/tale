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
import { listMemberPersonalApiKeys, setPersonalApiKeyBlock } from './blocks.ts';
import { SERVICE_KEY_ROLES } from './owners.ts';
import {
  API_KEY_LIST_SCOPES,
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
 *    Admin, every key bound to this organization. An Owner or Admin may ask
 *    for every key that works here (`scope=all`), which adds the members'
 *    own keys, read-only, and says whether the organization lets them in
 *    (`personalKeys`, APIKEY-R12): while it does not, none of them is listed.
 *  - `POST /` makes a key for another member, a team, a project or the
 *    organization (Owners and Admins). A person's own key is still made at
 *    the api-key plugin's `/api/auth/api-key/create`, behind its create gate.
 *  - `DELETE /:keyId` ends a key bound to this organization. A person's own
 *    key is ended at the plugin's `/api/auth/api-key/delete`.
 *  - `GET /members/:userId/personal` lists a member's own keys with this
 *    organization's block on each, and `PUT` / `DELETE /:keyId/block`
 *    block one here or lift the block (Owners and Admins, APIKEY-R11).
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

const listQuerySchema = z.object({
  scope: z.enum(API_KEY_LIST_SCOPES).default('managed'),
});

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
    const query = listQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        { error: 'scope is managed or all', code: 'INVALID_QUERY' },
        400,
      );
    }
    return c.json(
      await listApiKeysForViewer(
        deps.sql,
        {
          organizationId: c.get('orgId'),
          userId: c.get('sessionBundle').user.id,
          role: c.get('orgMember').role,
        },
        query.data.scope,
      ),
    );
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

  app.get('/members/:userId/personal', async (c) => {
    try {
      return c.json(
        await listMemberPersonalApiKeys(deps.sql, {
          organizationId: c.get('orgId'),
          actor: {
            userId: c.get('sessionBundle').user.id,
            role: c.get('orgMember').role,
          },
          memberUserId: c.req.param('userId'),
        }),
      );
    } catch (error) {
      return refusal(c, error);
    }
  });

  const setBlock = async (c: Context<OrgEnv>, blocked: boolean) => {
    try {
      const { changed } = await setPersonalApiKeyBlock(deps, {
        organizationId: c.get('orgId'),
        actor: await actorOf(c),
        keyId: c.req.param('keyId') ?? '',
        blocked,
      });
      return c.json({ ok: true, blocked, changed });
    } catch (error) {
      return refusal(c, error);
    }
  };
  app.put('/:keyId/block', (c) => setBlock(c, true));
  app.delete('/:keyId/block', (c) => setBlock(c, false));

  return app;
}
