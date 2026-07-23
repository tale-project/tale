'use node';

/**
 * Public write surface of the integration-credential domain — the two entry
 * points that may carry secret material, and therefore run as `'use node'`
 * actions: plaintext exists only inside this module, is encrypted with
 * `lib/secret_box` into the single `encryptedData` envelope, and only
 * ciphertext (plus the write-time masked preview) crosses into the V8
 * transactional mutations. Nothing here ever RETURNS secret material.
 *
 * Everything the CONNECTOR decides is enforced here, because the shipped
 * catalog lives on disk and a V8 mutation cannot read it:
 *
 *  - the auth method must be one the connector's `auth[]` actually declares —
 *    a refusal names the methods it does offer;
 *  - `endpointUrl` is REQUIRED for a connector declaring
 *    `endpointMode: per-credential` and REFUSED for a fixed-endpoint one;
 *  - the plaintext payload must match the method's shape before it is
 *    encrypted, so no row can be written that resolution cannot read.
 *
 * Writes are gated on the developer-settings capability, matching the
 * settings route that fronts them.
 */

import { ConvexError, v } from 'convex/values';

import type { IntegrationConnector } from '../../lib/shared/schemas/integrations';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { encryptSecret, type EncryptedSecret } from '../lib/secret_box';
import {
  parseSecretPayload,
  SecretPayloadError,
  type IntegrationSecretPayload,
} from './auth_injection';
import { loadIntegrationConnectors } from './connector_catalog';
import { maskPayload } from './masking';
import { normalizeEndpointOrigin } from './mutations';
import { integrationAuthMethodValidator } from './schema';

type IntegrationAuthMethodName = 'api-key' | 'bearer' | 'basic' | 'oauth2';

/** Bound on any single secret string a credential may carry. */
const SECRET_VALUE_MAX = 8192;

/** The row shape the internal queries return (`returns: v.any()` erases it
 * on the wire). */
interface CredentialRow {
  _id: Id<'integrationCredentials'>;
  organizationId: string;
  connectorSlug: string;
  authMethod: IntegrationAuthMethodName;
  name: string;
  encryptedData: EncryptedSecret;
  endpointUrl?: string;
  status: 'active' | 'disabled' | 'needs-reauth';
}

/** Trimmed, bounded secret value or a structured refusal. */
function normalizeSecretValue(raw: string, field: string): string {
  const value = raw.trim();
  if (value.length === 0 || value.length > SECRET_VALUE_MAX) {
    throw new ConvexError({
      code: 'CREDENTIAL_SECRET_INVALID',
      message: `${field} must be 1..${SECRET_VALUE_MAX} characters.`,
    });
  }
  return value;
}

/**
 * Require the shipped connector for `connectorSlug` to offer `authMethod`;
 * refusals name what IS available so the caller can act on them.
 */
function requireConnectorAuthMethod(
  connectorSlug: string,
  authMethod: IntegrationAuthMethodName,
): IntegrationConnector {
  const connectors = loadIntegrationConnectors();
  const connector = connectors.find((entry) => entry.name === connectorSlug);
  if (!connector) {
    const known = connectors
      .map((entry) => entry.name)
      .sort()
      .join(', ');
    throw new ConvexError({
      code: 'CONNECTOR_UNKNOWN',
      message: `Unknown integration "${connectorSlug}" — available integrations: ${known}.`,
    });
  }
  if (!connector.auth.some((entry) => entry.method === authMethod)) {
    const offered = connector.auth.map((entry) => entry.method).join(', ');
    throw new ConvexError({
      code: 'AUTH_METHOD_NOT_SUPPORTED',
      message: `Integration "${connectorSlug}" does not accept ${authMethod} credentials — it accepts: ${offered}. Pick one of those methods.`,
    });
  }
  return connector;
}

/** The shipped connector a stored row belongs to, or a refusal naming it. */
function requireConnector(connectorSlug: string): IntegrationConnector {
  const connector = loadIntegrationConnectors().find(
    (entry) => entry.name === connectorSlug,
  );
  if (!connector) {
    throw new ConvexError({
      code: 'CONNECTOR_UNKNOWN',
      message: `Integration "${connectorSlug}" has no connector on this deployment.`,
    });
  }
  return connector;
}

/**
 * Per-credential API origin: required exactly when the connector declares
 * `endpointMode: per-credential` (the Atlassian site for Confluence, the
 * merchant store for Shopify), refused otherwise. Shape (https origin, no
 * path) is the mutation's rule, applied here too so the refusal arrives
 * before anything is encrypted.
 */
function normalizeEndpointUrl(
  connector: IntegrationConnector,
  raw: string | undefined,
): string | undefined {
  if (connector.endpointMode === 'per-credential') {
    if (raw === undefined) {
      throw new ConvexError({
        code: 'CREDENTIAL_ENDPOINT_REQUIRED',
        message: `Integration "${connector.name}" uses one endpoint per credential — enter the instance URL (e.g. https://your-site.atlassian.net).`,
      });
    }
    return normalizeEndpointOrigin(raw);
  }
  if (raw !== undefined) {
    throw new ConvexError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Integration "${connector.name}" has a fixed endpoint — a per-credential endpoint URL does not apply here.`,
    });
  }
  return undefined;
}

/**
 * Validate and coerce a connector's non-secret per-credential config against
 * its `configFields`: every required field present, every value the declared
 * type (numbers coerced from numeric strings), enums honoured, defaults
 * applied, and no field the connector never declared. Returns undefined when
 * the connector declares none, so a row without config stays clean.
 */
function normalizeConfig(
  connector: IntegrationConnector,
  raw: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
  const fields = connector.configFields;
  if (fields.length === 0) {
    if (raw !== undefined && Object.keys(raw).length > 0) {
      throw new ConvexError({
        code: 'CREDENTIAL_CONFIG_INVALID',
        message: `Integration "${connector.name}" takes no per-credential settings.`,
      });
    }
    return undefined;
  }

  const supplied = raw ?? {};
  const declared = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(supplied)) {
    if (!declared.has(key)) {
      throw new ConvexError({
        code: 'CREDENTIAL_CONFIG_INVALID',
        message: `Integration "${connector.name}" has no setting "${key}".`,
      });
    }
  }

  const out: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const provided = supplied[field.key];
    const value = provided ?? field.default;
    if (value === undefined || value === '') {
      if (field.required) {
        throw new ConvexError({
          code: 'CREDENTIAL_CONFIG_REQUIRED',
          message: `Integration "${connector.name}" needs "${field.label}".`,
        });
      }
      continue;
    }
    if (field.type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new ConvexError({
          code: 'CREDENTIAL_CONFIG_INVALID',
          message: `"${field.label}" must be a number.`,
        });
      }
      out[field.key] = n;
    } else if (field.type === 'boolean') {
      out[field.key] = value === true || value === 'true';
    } else {
      const s = String(value);
      if (field.enum && !field.enum.includes(s)) {
        throw new ConvexError({
          code: 'CREDENTIAL_CONFIG_INVALID',
          message: `"${field.label}" must be one of: ${field.enum.join(', ')}.`,
        });
      }
      out[field.key] = s;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The plaintext secret fields an action accepts, before validation. */
interface SecretInput {
  token?: string;
  username?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

/** Whether the caller supplied any secret material at all. */
function hasSecretInput(input: SecretInput): boolean {
  return (
    input.token !== undefined ||
    input.username !== undefined ||
    input.password !== undefined ||
    input.accessToken !== undefined ||
    input.refreshToken !== undefined
  );
}

/**
 * Fold the action's flat inputs into the method's payload and validate it.
 * Refusals name the fields the method needs, so a UI can highlight them.
 */
function buildPayload(
  authMethod: IntegrationAuthMethodName,
  input: SecretInput,
): IntegrationSecretPayload {
  const raw: Record<string, unknown> = (() => {
    switch (authMethod) {
      case 'api-key':
      case 'bearer':
        return {
          token:
            input.token === undefined
              ? undefined
              : normalizeSecretValue(input.token, 'The token'),
        };
      case 'basic':
        return {
          username: input.username?.trim(),
          password:
            input.password === undefined
              ? undefined
              : normalizeSecretValue(input.password, 'The password'),
        };
      case 'oauth2':
        return {
          accessToken:
            input.accessToken === undefined
              ? undefined
              : normalizeSecretValue(input.accessToken, 'The access token'),
          ...(input.refreshToken !== undefined && {
            refreshToken: normalizeSecretValue(
              input.refreshToken,
              'The refresh token',
            ),
          }),
          ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
          ...(input.scopes !== undefined && { scopes: input.scopes }),
        };
      default: {
        const _exhaustive: never = authMethod;
        return _exhaustive;
      }
    }
  })();
  // Drop the undefined placeholders so the payload schema reports a MISSING
  // field rather than an invalid one.
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) delete raw[key];
  }
  try {
    return parseSecretPayload(authMethod, raw);
  } catch (err) {
    if (err instanceof SecretPayloadError) {
      throw new ConvexError({
        code: 'CREDENTIAL_SECRET_INVALID',
        message: err.message,
      });
    }
    throw err;
  }
}

/** Encrypt a validated payload and compute its non-secret preview. */
function sealPayload(payload: IntegrationSecretPayload): {
  encryptedData: EncryptedSecret;
  maskedPreview?: string;
} {
  const { authMethod: _method, ...document } = payload;
  const maskedPreview = maskPayload(payload);
  return {
    encryptedData: encryptSecret(JSON.stringify(document)),
    ...(maskedPreview !== undefined && { maskedPreview }),
  };
}

const secretArgs = {
  /** api-key / bearer: the single secret value. */
  token: v.optional(v.string()),
  /** basic: the account login and its password (or app password). */
  username: v.optional(v.string()),
  password: v.optional(v.string()),
  /** oauth2: the granted tokens and what the grant reported about them. */
  accessToken: v.optional(v.string()),
  refreshToken: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
};

/**
 * Create one integration credential. The auth method must be offered by the
 * connector; the first credential of an (org, connector) pair becomes its
 * default, and `isDefault: true` promotes this one instead.
 */
export const createCredential = action({
  args: {
    organizationId: v.string(),
    connectorSlug: v.string(),
    authMethod: integrationAuthMethodValidator,
    name: v.string(),
    ...secretArgs,
    /** Per-credential-endpoint connectors only: the instance origin. */
    endpointUrl: v.optional(v.string()),
    /** Non-secret per-credential settings the connector declares. */
    config: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.object({ credentialId: v.id('integrationCredentials') }),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const connector = requireConnectorAuthMethod(
      args.connectorSlug,
      args.authMethod,
    );
    const endpointUrl = normalizeEndpointUrl(connector, args.endpointUrl);
    const config = normalizeConfig(connector, args.config);
    const sealed = sealPayload(buildPayload(args.authMethod, args));
    const credentialId: Id<'integrationCredentials'> = await ctx.runMutation(
      internal.integration_credentials.mutations.insertCredentialInternal,
      {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        authMethod: args.authMethod,
        name: args.name,
        ...sealed,
        ...(endpointUrl !== undefined && { endpointUrl }),
        ...(config !== undefined && { config }),
        ...(args.isDefault !== undefined && { isDefault: args.isDefault }),
        status: 'active',
        createdBy: auth.userId,
      },
    );
    return { credentialId };
  },
});

/**
 * Update one credential: label, endpoint, status, default flag, and secret
 * replacement. A replacement is validated against the row's EXISTING method
 * (the method itself never changes — a different way of authenticating is a
 * different credential), re-encrypted whole, and re-previewed. Replacing an
 * oauth2 grant clears `needs-reauth` unless the caller sets a status
 * explicitly, because reconnecting is exactly what that status asks for.
 * Responses carry no secret material.
 */
export const updateCredential = action({
  args: {
    organizationId: v.string(),
    credentialId: v.id('integrationCredentials'),
    name: v.optional(v.string()),
    ...secretArgs,
    endpointUrl: v.optional(v.string()),
    config: v.optional(
      v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    ),
    status: v.optional(v.union(v.literal('active'), v.literal('disabled'))),
    isDefault: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the internal query returns the full row as v.any(); this names its shape
    const row = (await ctx.runQuery(
      internal.integration_credentials.queries.getCredentialInternal,
      { credentialId: args.credentialId },
    )) as CredentialRow | null;
    if (!row || row.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'CREDENTIAL_NOT_FOUND',
        message: 'Credential not found.',
      });
    }

    // An endpoint replacement re-validates against the connector's declared
    // endpoint mode, exactly like create.
    const endpointUrl =
      args.endpointUrl === undefined
        ? undefined
        : normalizeEndpointUrl(
            requireConnector(row.connectorSlug),
            args.endpointUrl,
          );

    // Config is replaced as a whole when supplied, re-validated against the
    // connector's declared fields exactly like create.
    const config =
      args.config === undefined
        ? undefined
        : normalizeConfig(requireConnector(row.connectorSlug), args.config);

    const replacing = hasSecretInput(args);
    const sealed = replacing
      ? sealPayload(buildPayload(row.authMethod, args))
      : undefined;
    // The preview belongs to the ciphertext: send an explicit null when the
    // new secret is too short to excerpt, so the old preview cannot survive.
    const previewPatch =
      sealed === undefined
        ? {}
        : { maskedPreview: sealed.maskedPreview ?? null };
    const clearsReauth =
      replacing && args.status === undefined && row.status === 'needs-reauth';

    await ctx.runMutation(
      internal.integration_credentials.mutations.patchCredentialInternal,
      {
        organizationId: args.organizationId,
        credentialId: args.credentialId,
        ...(args.name !== undefined && { name: args.name }),
        ...(endpointUrl !== undefined && { endpointUrl }),
        ...(config !== undefined && { config }),
        ...(sealed !== undefined && { encryptedData: sealed.encryptedData }),
        ...previewPatch,
        ...(args.status !== undefined && { status: args.status }),
        ...(clearsReauth && { status: 'active' as const, statusDetail: null }),
        ...(args.isDefault !== undefined && { isDefault: args.isDefault }),
      },
    );
    return null;
  },
});
