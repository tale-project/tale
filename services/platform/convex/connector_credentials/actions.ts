'use node';

/**
 * Public write surface of the connector-credential domain — the three entry
 * points that may carry secret material, and therefore run as `'use node'`
 * actions: plaintext exists only inside this module, is encrypted with
 * `lib/secret_box` into the single `encryptedData` envelope, and only
 * ciphertext (plus the write-time masked preview) crosses into the V8
 * transactional mutations. Nothing here ever RETURNS secret material.
 * `storeOauth2Credential` is the internal OAuth-callback path (no session).
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

import type { Connector } from '../../lib/shared/schemas/connectors';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action, internalAction } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { encryptSecret, type EncryptedSecret } from '../lib/secret_box';
import {
  parseSecretPayload,
  SecretPayloadError,
  type ConnectorSecretPayload,
} from './auth_injection';
import { loadConnectorDefinitions } from './connector_catalog';
import {
  storedImapFromAddress,
  withImapFromAddress,
} from './imap_from_address';
import { maskPayload } from './masking';
import { normalizeEndpointOrigin } from './mutations';
import { connectorAuthMethodValidator } from './schema';

type ConnectorAuthMethodName = 'api-key' | 'bearer' | 'basic' | 'oauth2';

/** Bound on any single secret string a credential may carry. */
const SECRET_VALUE_MAX = 8192;

/** The row shape the internal queries return (`returns: v.any()` erases it
 * on the wire). */
interface CredentialRow {
  _id: Id<'connectorCredentials'>;
  organizationId: string;
  connectorSlug: string;
  authMethod: ConnectorAuthMethodName;
  name: string;
  encryptedData: EncryptedSecret;
  endpointUrl?: string;
  config?: Record<string, string | number | boolean>;
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
  authMethod: ConnectorAuthMethodName,
): Connector {
  const connectors = loadConnectorDefinitions();
  const connector = connectors.find((entry) => entry.name === connectorSlug);
  if (!connector) {
    const known = connectors
      .map((entry) => entry.name)
      .sort()
      .join(', ');
    throw new ConvexError({
      code: 'CONNECTOR_UNKNOWN',
      message: `Unknown connector "${connectorSlug}" — available connectors: ${known}.`,
    });
  }
  if (!connector.auth.some((entry) => entry.method === authMethod)) {
    const offered = connector.auth.map((entry) => entry.method).join(', ');
    throw new ConvexError({
      code: 'AUTH_METHOD_NOT_SUPPORTED',
      message: `Connector "${connectorSlug}" does not accept ${authMethod} credentials — it accepts: ${offered}. Pick one of those methods.`,
    });
  }
  return connector;
}

/** The shipped connector a stored row belongs to, or a refusal naming it. */
function requireConnector(connectorSlug: string): Connector {
  const connector = loadConnectorDefinitions().find(
    (entry) => entry.name === connectorSlug,
  );
  if (!connector) {
    throw new ConvexError({
      code: 'CONNECTOR_UNKNOWN',
      message: `Connector "${connectorSlug}" has no connector on this deployment.`,
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
  connector: Connector,
  raw: string | undefined,
): string | undefined {
  if (connector.endpointMode === 'per-credential') {
    if (raw === undefined) {
      throw new ConvexError({
        code: 'CREDENTIAL_ENDPOINT_REQUIRED',
        message: `Connector "${connector.name}" uses one endpoint per credential — enter the instance URL (e.g. https://your-site.atlassian.net).`,
      });
    }
    return normalizeEndpointOrigin(raw);
  }
  if (raw !== undefined) {
    throw new ConvexError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Connector "${connector.name}" has a fixed endpoint — a per-credential endpoint URL does not apply here.`,
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
  connector: Connector,
  raw: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
  const fields = connector.configFields;
  if (fields.length === 0) {
    if (raw !== undefined && Object.keys(raw).length > 0) {
      throw new ConvexError({
        code: 'CREDENTIAL_CONFIG_INVALID',
        message: `Connector "${connector.name}" takes no per-credential settings.`,
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
        message: `Connector "${connector.name}" has no setting "${key}".`,
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
          message: `Connector "${connector.name}" needs "${field.label}".`,
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
  /** imap-smtp: optional SMTP relay login, paired with `smtpPassword`. */
  smtpUsername?: string;
  smtpPassword?: string;
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
    input.smtpUsername !== undefined ||
    input.smtpPassword !== undefined ||
    input.accessToken !== undefined ||
    input.refreshToken !== undefined
  );
}

/**
 * Fold the action's flat inputs into the method's payload and validate it.
 * Refusals name the fields the method needs, so a UI can highlight them.
 */
function buildPayload(
  authMethod: ConnectorAuthMethodName,
  input: SecretInput,
): ConnectorSecretPayload {
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
          // A separate SMTP relay login (Resend / SendGrid / SES). Omitted
          // entirely when the form left the toggle off — the whole payload is
          // rewritten on replace, so absence clears a previously stored pair.
          ...(input.smtpUsername !== undefined ||
          input.smtpPassword !== undefined
            ? {
                smtpUsername: input.smtpUsername?.trim(),
                smtpPassword:
                  input.smtpPassword === undefined
                    ? undefined
                    : normalizeSecretValue(
                        input.smtpPassword,
                        'The SMTP password',
                      ),
              }
            : {}),
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
function sealPayload(payload: ConnectorSecretPayload): {
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
  /** basic + imap-smtp: optional SMTP relay login when sending is not the
   * mailbox account (both fields required together). */
  smtpUsername: v.optional(v.string()),
  smtpPassword: v.optional(v.string()),
  /** oauth2: the granted tokens and what the grant reported about them. */
  accessToken: v.optional(v.string()),
  refreshToken: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
};

/**
 * Create one connector credential. The auth method must be offered by the
 * connector; the first credential of an (org, connector) pair becomes its
 * default, and `isDefault: true` promotes this one instead.
 */
export const createCredential = action({
  args: {
    organizationId: v.string(),
    connectorSlug: v.string(),
    authMethod: connectorAuthMethodValidator,
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
  returns: v.object({ credentialId: v.id('connectorCredentials') }),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const connector = requireConnectorAuthMethod(
      args.connectorSlug,
      args.authMethod,
    );
    const endpointUrl = normalizeEndpointUrl(connector, args.endpointUrl);
    const config = withImapFromAddress(
      args.connectorSlug,
      normalizeConfig(connector, args.config),
      args.username,
    );
    const sealed = sealPayload(buildPayload(args.authMethod, args));
    const credentialId: Id<'connectorCredentials'> = await ctx.runMutation(
      internal.connector_credentials.mutations.insertCredentialInternal,
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
    credentialId: v.id('connectorCredentials'),
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
      internal.connector_credentials.queries.getCredentialInternal,
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
    // connector's declared fields exactly like create. IMAP From tracks the
    // login username (same value) whenever we have a username in this write;
    // with no username, the stored mirror is carried over rather than dropped —
    // the field is server-owned and never rendered, so a caller replacing config
    // has no way to resupply it.
    const normalizedConfig =
      args.config === undefined
        ? undefined
        : normalizeConfig(requireConnector(row.connectorSlug), args.config);
    const configPatch =
      args.config !== undefined
        ? withImapFromAddress(
            row.connectorSlug,
            normalizedConfig,
            args.username ?? storedImapFromAddress(row),
          )
        : args.username !== undefined
          ? withImapFromAddress(row.connectorSlug, row.config, args.username)
          : undefined;

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
      internal.connector_credentials.mutations.patchCredentialInternal,
      {
        organizationId: args.organizationId,
        credentialId: args.credentialId,
        ...(args.name !== undefined && { name: args.name }),
        ...(endpointUrl !== undefined && { endpointUrl }),
        ...(configPatch !== undefined && { config: configPatch }),
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

/**
 * Persist an OAuth2 authorization-code grant from the connector HTTP callback.
 *
 * The callback has no Convex user identity — the user was authorized at
 * `/oauth2/start` and recorded on the pending-state row — so this action takes
 * `createdBy` explicitly and must not call `requireOrgAdminOrDeveloper`. It is
 * `internalAction` so only other Convex functions (the OAuth callback) can
 * invoke it with tokens.
 */
export const storeOauth2Credential = internalAction({
  args: {
    organizationId: v.string(),
    connectorSlug: v.string(),
    createdBy: v.string(),
    name: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
  },
  returns: v.object({ credentialId: v.string() }),
  handler: async (ctx, args) => {
    requireConnectorAuthMethod(args.connectorSlug, 'oauth2');
    const sealed = sealPayload(
      buildPayload('oauth2', {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
      }),
    );
    const credentialId: Id<'connectorCredentials'> = await ctx.runMutation(
      internal.connector_credentials.mutations.insertCredentialInternal,
      {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        authMethod: 'oauth2',
        name: args.name,
        encryptedData: sealed.encryptedData,
        ...(sealed.maskedPreview !== undefined && {
          maskedPreview: sealed.maskedPreview,
        }),
        status: 'active',
        createdBy: args.createdBy,
      },
    );
    return { credentialId };
  },
});
