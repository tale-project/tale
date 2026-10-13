import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { loadTrustedProxies, type Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireGlobalSession } from '../../auth/session-authority.ts';
import { requireSession } from '../../auth/session.ts';
import {
  getClientIp,
  nodePeerAddress,
} from '../../core/lib/utils/client_ip.ts';
import {
  ConsentContextError,
  readAgentConsentContext,
} from './consent-context.ts';
import {
  type AgentConnectionViewer,
  AgentConnectionError,
  disconnectAgent,
  listAgentConnections,
} from './service.ts';

/**
 * /api/app/agent-connections — the coding agents people connected to one
 * organization by signing in on the MCP endpoint.
 *
 *  - `GET /` lists the caller's own connections; an owner or admin may ask
 *    for everyone's (`scope=everyone`) and for the ended ones
 *    (`ended=true`). `since` (epoch milliseconds) keeps what was made,
 *    changed or ended after it.
 *  - `DELETE /:id` ends a connection: the caller's own, or — for an owner
 *    or admin — anyone's here. Any other is not found.
 *
 * `GET /consent-context` is the one route that names no organization: the
 * consent page of a coding agent asks it, before the person has chosen one,
 * who the app is and where they may connect it. It answers a person who
 * signed in for themselves, and no session that belongs to one organization.
 */

const contextQuerySchema = z.object({
  client_id: z.string().min(1).max(2048),
  scope: z.string().max(2048).optional(),
});

const listQuerySchema = z.object({
  scope: z.enum(['mine', 'everyone']).default('mine'),
  ended: z.enum(['true', 'false']).default('false'),
  since: z.coerce.number().int().nonnegative().optional(),
});

export function createAgentConnectionRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth));

  app.get('/consent-context', requireGlobalSession(), async (c) => {
    const query = contextQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        {
          error: 'client_id is required and scope is a space-separated list',
          code: 'INVALID_QUERY',
        },
        400,
      );
    }
    const { user, session } = c.get('sessionBundle');
    try {
      const context = await readAgentConsentContext(deps.sql, {
        userId: user.id,
        activeOrganizationId: session.activeOrganizationId ?? null,
        clientId: query.data.client_id,
        scope: query.data.scope,
      });
      c.header('cache-control', 'no-store');
      return c.json(context);
    } catch (error) {
      if (error instanceof ConsentContextError) {
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      throw error;
    }
  });

  app.use(requireOrgMember(deps.sql));

  /** The signed-in person acting here, as the audit rows name them. */
  const viewerOf = async (
    c: Context<OrgEnv>,
  ): Promise<AgentConnectionViewer> => {
    const user = c.get('sessionBundle').user;
    const ip = getClientIp(c.req.raw.headers, await loadTrustedProxies(), {
      peer: nodePeerAddress(c.env),
    });
    const userAgent = c.req.header('user-agent');
    return {
      userId: user.id,
      role: c.get('orgMember').role,
      ...(user.email ? { email: user.email } : {}),
      ...(ip === 'unknown' ? {} : { ip }),
      ...(userAgent === undefined ? {} : { userAgent }),
    };
  };

  app.get('/', async (c) => {
    const query = listQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json(
        {
          error:
            'scope is mine or everyone, ended is true or false, and since is a number of milliseconds',
          code: 'INVALID_QUERY',
        },
        400,
      );
    }
    return c.json(
      await listAgentConnections(deps.sql, {
        organizationId: c.get('orgId'),
        viewerId: c.get('sessionBundle').user.id,
        viewerRole: c.get('orgMember').role,
        everyone: query.data.scope === 'everyone',
        includeEnded: query.data.ended === 'true',
        ...(query.data.since === undefined ? {} : { since: query.data.since }),
      }),
    );
  });

  app.delete('/:id', async (c) => {
    try {
      return c.json({
        ...(await disconnectAgent(deps.sql, {
          organizationId: c.get('orgId'),
          connectionId: c.req.param('id'),
          viewer: await viewerOf(c),
        })),
        ok: true,
      });
    } catch (error) {
      if (error instanceof AgentConnectionError) {
        return c.json(
          { error: error.code, message: error.message },
          error.status,
        );
      }
      throw error;
    }
  });

  return app;
}
