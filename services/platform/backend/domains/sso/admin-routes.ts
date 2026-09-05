import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import {
  attributeMappingSchema,
  platformRoleSchema,
  roleMappingRuleSchema,
} from '../../../lib/shared/schemas/enterprise_sso.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  getSsoConnectionView,
  parseSsoIdpMetadata,
  removeSsoConnection,
  revealSsoClientId,
  setSsoEnabled,
  setSsoProvisioning,
  SsoAdminError,
  testSsoConnection,
  upsertOidcConnection,
  upsertSamlConnection,
  type SsoActor,
} from './admin.ts';
import {
  getSsoDiscoveryStatus,
  listSelectableSsoConnections,
} from './config.ts';

/**
 * /api/app/sso — the admin settings surface for the file-backed SSO
 * connection (the sign-in protocol endpoints live unauthenticated at
 * `/api/sso`). Reads = org member; every write = the orgSettings ability
 * (the 0.4 admin gate).
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof SsoAdminError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

const provisioningSchema = z.object({
  autoProvisionRole: z.boolean(),
  defaultRole: platformRoleSchema,
  roleMappingRules: z.array(roleMappingRuleSchema).max(100),
  autoProvisionTeam: z.boolean(),
  excludeGroups: z.array(z.string().max(200)).max(200),
});
const optionalAttributeMapping = attributeMappingSchema.optional();
const providerIdSchema = z.enum(['entra-id', 'generic-oidc', 'oauth2']);

export function createSsoAdminRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();

  // Public login-page discovery (pre-auth BY DESIGN — the 0.4
  // `enterprise_sso/queries` pair ran with no auth gate): whether any org
  // has SSO enabled, and the selectable connections for the org picker.
  app.get('/discovery/configured', async (c) =>
    c.json(await getSsoDiscoveryStatus(deps.sql)),
  );
  app.get('/discovery/selectable', async (c) =>
    c.json({ connections: await listSelectableSsoConnections(deps.sql) }),
  );

  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const requireSettingsWrite = (c: Context<OrgEnv>): Response | null => {
    if (
      defineAbilityFor(c.get('orgMember').role).cannot('write', 'orgSettings')
    ) {
      return c.json({ error: 'Only admins can configure SSO' }, 403);
    }
    return null;
  };
  const actor = (c: Context<OrgEnv>): SsoActor => ({
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
    role: c.get('orgMember').role,
  });

  app.get('/config', async (c) => {
    return c.json(await getSsoConnectionView(deps.sql, c.get('orgId')));
  });

  app.put('/config/oidc', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    const body = z
      .object({
        displayName: z.string().min(1).max(200),
        domain: z.string().max(255).optional(),
        providerId: providerIdSchema,
        issuer: z.string().min(1).max(2000),
        authorizationEndpoint: z.string().max(2000).optional(),
        tokenEndpoint: z.string().max(2000).optional(),
        userinfoEndpoint: z.string().max(2000).optional(),
        clientId: z.string().min(1).max(500),
        clientSecret: z.string().max(5000).optional(),
        scopes: z.array(z.string().max(200)).max(50),
        pkce: z.boolean().optional(),
        claimMappings: optionalAttributeMapping,
        domainHint: z.string().max(255).optional(),
      })
      .merge(provisioningSchema)
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await upsertOidcConnection(deps.sql, c.get('orgId'), actor(c), body.data);
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.put('/config/saml', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    const body = z
      .object({
        displayName: z.string().min(1).max(200),
        domain: z.string().max(255).optional(),
        idpEntityId: z.string().min(1).max(2000),
        idpSsoUrl: z.string().min(1).max(2000),
        idpCertificate: z.string().min(1).max(20_000),
        spPrivateKey: z.string().max(20_000).optional(),
        spCertificate: z.string().max(20_000).optional(),
        wantAssertionsSigned: z.boolean().optional(),
        wantAssertionsEncrypted: z.boolean().optional(),
        attributeMappings: optionalAttributeMapping,
      })
      .merge(provisioningSchema)
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await upsertSamlConnection(deps.sql, c.get('orgId'), actor(c), body.data);
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.put('/config/provisioning', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    const body = provisioningSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await setSsoProvisioning(deps.sql, c.get('orgId'), actor(c), body.data);
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/config/enabled', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    const body = z
      .object({ enabled: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await setSsoEnabled(
        deps.sql,
        c.get('orgId'),
        actor(c),
        body.data.enabled,
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/config', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    try {
      await removeSsoConnection(deps.sql, c.get('orgId'), actor(c));
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/config/client-id', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    try {
      return c.json({
        clientId: await revealSsoClientId(deps.sql, c.get('orgId')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/config/test', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    const body = z
      .object({
        providerId: providerIdSchema,
        issuer: z.string().min(1).max(2000),
        authorizationEndpoint: z.string().max(2000).optional(),
        tokenEndpoint: z.string().max(2000).optional(),
        userinfoEndpoint: z.string().max(2000).optional(),
        clientId: z.string().min(1).max(500),
        clientSecret: z.string().max(5000).optional(),
        scopes: z.array(z.string().max(200)).max(50),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      return c.json(
        await testSsoConnection(deps.sql, c.get('orgId'), body.data),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/config/parse-idp-metadata', async (c) => {
    const denied = requireSettingsWrite(c);
    if (denied) return denied;
    const body = z
      .object({
        url: z.string().max(2000).optional(),
        xml: z.string().max(1_000_000).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      return c.json(await parseSsoIdpMetadata(body.data));
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
