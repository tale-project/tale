'use node';

/**
 * Public write surface of the provider-credential domain — the two entry
 * points that may carry secret material, and therefore run as `'use node'`
 * actions: plaintext exists only inside this module, is encrypted with
 * `lib/secret_box`, and only ciphertext (plus the write-time masked preview)
 * crosses into the V8 transactional mutations. Nothing here ever RETURNS
 * secret material.
 *
 * Creation validates the requested auth method against the provider
 * CONNECTOR's declared auth list (`configs/platform/system/providers/`) — a
 * credential for a method the provider doesn't offer is refused with the
 * methods it does. Broker payloads validate against
 * `brokerCredentialDataSchema` before encryption.
 *
 * Writes are gated on the developer-settings capability, matching the
 * settings route that fronts them.
 */

import { ConvexError, v } from 'convex/values';
import { z } from 'zod/v4';

import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import type { BrokerCredentialData } from '../../lib/shared/schemas/providers';
import {
  brokerCredentialDataSchema,
  providerBaseUrlSchema,
  providerKeyEnvNameSchema,
} from '../../lib/shared/schemas/providers';
import type { ProviderDefinition } from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import {
  decryptSecret,
  encryptSecret,
  KeyRotatedError,
  type EncryptedSecret,
} from '../lib/secret_box';
import { maskSecret } from './masking';
import { providerAuthMethodValidator } from './schema';

const SECRET_VALUE_MAX = 8192;

/** The full row shape the internal queries return (`returns: v.any()`
 * erases it on the wire). */
interface CredentialRow {
  _id: Id<'providerCredentials'>;
  organizationId: string;
  providerSlug: string;
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  name: string;
  encryptedData?: EncryptedSecret;
  envName?: string;
  status: 'active' | 'disabled';
}

/** Trimmed, bounded secret value or a structured refusal. */
function normalizeSecretValue(raw: string): string {
  const value = raw.trim();
  if (value.length === 0 || value.length > SECRET_VALUE_MAX) {
    throw new ConvexError({
      code: 'CREDENTIAL_SECRET_INVALID',
      message: `Secret value must be 1..${SECRET_VALUE_MAX} characters.`,
      userMessage: `Secret value must be 1–${SECRET_VALUE_MAX} characters.`,
    });
  }
  return value;
}

/** Prefix-gated env-var name (shape + 40-char sync cap) or a refusal. */
function normalizeEnvName(raw: string): string {
  const result = providerKeyEnvNameSchema.safeParse(raw.trim());
  if (!result.success) {
    throw new ConvexError({
      code: 'CREDENTIAL_ENV_NAME_INVALID',
      message: `Env name "${raw.trim()}" is not usable: ${zodErrorMessage('it', result.error)}. Name the variable under the TALE_PROVIDER_KEY_ namespace.`,
    });
  }
  return result.data;
}

/** Validate an incoming broker payload; zod errors become actionable. */
function parseBrokerData(raw: unknown): BrokerCredentialData {
  try {
    return brokerCredentialDataSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ConvexError({
        code: 'CREDENTIAL_BROKER_INVALID',
        message: zodErrorMessage('Invalid broker configuration', err),
      });
    }
    throw err;
  }
}

/**
 * Require the provider for `providerSlug` (shipped or org-defined) to offer
 * `authMethod`; refusals name what IS available so the caller can act on
 * them.
 */
function requireProviderAuthMethod(
  providers: readonly ProviderDefinition[],
  providerSlug: string,
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker',
): ProviderDefinition {
  const provider = providers.find((entry) => entry.name === providerSlug);
  if (!provider) {
    const known = providers
      .map((entry) => entry.name)
      .sort()
      .join(', ');
    throw new ConvexError({
      code: 'PROVIDER_UNKNOWN',
      message: `Unknown provider "${providerSlug}" — available providers: ${known}.`,
    });
  }
  if (!provider.auth.some((entry) => entry.method === authMethod)) {
    const offered = provider.auth.map((entry) => entry.method).join(', ');
    throw new ConvexError({
      code: 'AUTH_METHOD_NOT_SUPPORTED',
      message: `Provider "${providerSlug}" does not accept ${authMethod} credentials — it offers: ${offered}. Pick one of those methods, or a provider that supports ${authMethod}.`,
    });
  }
  return provider;
}

/**
 * Per-credential wire endpoint (Azure-style providers): required exactly
 * when the provider declares `endpointMode: per-credential`, refused
 * otherwise; https-only like every provider base URL.
 */
function normalizeEndpointUrl(
  provider: ProviderDefinition,
  raw: string | undefined,
): string | undefined {
  if (provider.endpointMode === 'per-credential') {
    if (raw === undefined) {
      throw new ConvexError({
        code: 'CREDENTIAL_ENDPOINT_REQUIRED',
        message: `Provider "${provider.name}" uses per-credential endpoints — enter the resource endpoint URL (e.g. https://YOUR-RESOURCE.openai.azure.com/openai/v1).`,
      });
    }
    const outcome = providerBaseUrlSchema.safeParse(raw.trim());
    if (!outcome.success) {
      throw new ConvexError({
        code: 'CREDENTIAL_ENDPOINT_INVALID',
        message: `Endpoint "${raw.trim()}" is not usable: ${zodErrorMessage('it', outcome.error)}.`,
      });
    }
    return outcome.data;
  }
  if (raw !== undefined) {
    throw new ConvexError({
      code: 'CREDENTIAL_ENDPOINT_INVALID',
      message: `Provider "${provider.name}" has a fixed endpoint — a per-credential endpoint URL does not apply here.`,
    });
  }
  return undefined;
}

/** The per-method secret payload of a row, computed from action input. */
interface SecretPayload {
  encryptedData?: EncryptedSecret;
  envName?: string;
  maskedPreview?: string;
}

function buildSecretPayload(args: {
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  secret?: string;
  envName?: string;
  broker?: unknown;
}): SecretPayload {
  switch (args.authMethod) {
    // A subscription-key is a static vendor secret stored exactly like an
    // api key; its forced-execution constraints live on the provider.
    case 'api-key':
    case 'subscription-key': {
      if (args.secret === undefined) {
        throw new ConvexError({
          code: 'CREDENTIAL_SECRET_INVALID',
          message: `A ${args.authMethod} credential needs the secret value.`,
        });
      }
      const secret = normalizeSecretValue(args.secret);
      return {
        encryptedData: encryptSecret(secret),
        maskedPreview: maskSecret(secret),
      };
    }
    case 'env': {
      if (args.envName === undefined) {
        throw new ConvexError({
          code: 'CREDENTIAL_ENV_NAME_INVALID',
          message: 'An env credential needs the environment-variable name.',
        });
      }
      return { envName: normalizeEnvName(args.envName) };
    }
    case 'subscription-broker': {
      if (args.broker === undefined) {
        throw new ConvexError({
          code: 'CREDENTIAL_BROKER_INVALID',
          message:
            'A subscription-broker credential needs the broker configuration.',
        });
      }
      const broker = parseBrokerData(args.broker);
      return {
        encryptedData: encryptSecret(JSON.stringify(broker)),
        ...(broker.authSecret !== undefined && {
          maskedPreview: maskSecret(broker.authSecret),
        }),
      };
    }
    default: {
      const _exhaustive: never = args.authMethod;
      return _exhaustive;
    }
  }
}

/**
 * Create one provider credential. The auth method must be offered by the
 * provider's provider; the first credential of an (org, provider) pair
 * becomes its default.
 */
export const createCredential = action({
  args: {
    organizationId: v.string(),
    providerSlug: v.string(),
    authMethod: providerAuthMethodValidator,
    name: v.string(),
    /** api-key / subscription-key: the secret value. Never stored in
     * plaintext. */
    secret: v.optional(v.string()),
    /** env only: the TALE_PROVIDER_KEY_-prefixed variable name. */
    envName: v.optional(v.string()),
    /** subscription-broker only: a `brokerCredentialDataSchema` document
     * (validated here; encrypted whole, including its authSecret). */
    broker: v.optional(v.any()),
    /** Per-credential-endpoint providers (Azure) only: the resource
     * endpoint URL. */
    endpointUrl: v.optional(v.string()),
    modelAllowlist: v.optional(v.array(v.string())),
  },
  returns: v.object({ credentialId: v.id('providerCredentials') }),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const provider = requireProviderAuthMethod(
      await resolveProvidersForOrgId(ctx, args.organizationId),
      args.providerSlug,
      args.authMethod,
    );
    const endpointUrl = normalizeEndpointUrl(provider, args.endpointUrl);
    const payload = buildSecretPayload(args);
    const credentialId: Id<'providerCredentials'> = await ctx.runMutation(
      internal.provider_credentials.mutations.insertCredentialInternal,
      {
        organizationId: args.organizationId,
        providerSlug: args.providerSlug,
        authMethod: args.authMethod,
        name: args.name,
        ...payload,
        ...(endpointUrl !== undefined && { endpointUrl }),
        ...(args.modelAllowlist !== undefined && {
          modelAllowlist: args.modelAllowlist,
        }),
        status: 'active',
        createdBy: auth.userId,
      },
    );
    return { credentialId };
  },
});

/**
 * Update one credential: label, allowlist (null clears), status, default
 * flag, and secret replacement — a fresh api key, a new env name, or a new
 * broker configuration (which keeps the previously stored broker secret
 * when the new payload omits it, so editing the mapping never forces
 * re-entering the secret). Responses carry no secret material.
 */
export const updateCredential = action({
  args: {
    organizationId: v.string(),
    credentialId: v.id('providerCredentials'),
    name: v.optional(v.string()),
    modelAllowlist: v.optional(v.union(v.array(v.string()), v.null())),
    status: v.optional(v.union(v.literal('active'), v.literal('disabled'))),
    isDefault: v.optional(v.boolean()),
    secret: v.optional(v.string()),
    envName: v.optional(v.string()),
    broker: v.optional(v.any()),
    /** Per-credential-endpoint providers (Azure) only: replace the
     * resource endpoint URL. */
    endpointUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const row = (await ctx.runQuery(
      internal.provider_credentials.queries.getCredentialInternal,
      { credentialId: args.credentialId },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the internal query returns the full row as v.any(); this names its shape
    )) as CredentialRow | null;
    if (!row || row.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'CREDENTIAL_NOT_FOUND',
        message: 'Credential not found.',
      });
    }

    // An endpoint replacement re-validates against the provider's declared
    // endpoint mode, exactly like create.
    let endpointReplacement: string | undefined;
    if (args.endpointUrl !== undefined) {
      const providers = await resolveProvidersForOrgId(
        ctx,
        args.organizationId,
      );
      const provider = providers.find(
        (entry) => entry.name === row.providerSlug,
      );
      if (!provider) {
        throw new ConvexError({
          code: 'PROVIDER_UNKNOWN',
          message: `Credential "${row.name}" belongs to provider "${row.providerSlug}", which has no provider on this deployment.`,
        });
      }
      endpointReplacement = normalizeEndpointUrl(provider, args.endpointUrl);
    }

    let replacement: SecretPayload = {};
    if (args.secret !== undefined) {
      if (
        row.authMethod !== 'api-key' &&
        row.authMethod !== 'subscription-key'
      ) {
        throw new ConvexError({
          code: 'CREDENTIAL_SHAPE_INVALID',
          message: `Secret replacement applies to api-key and subscription-key credentials; this one is ${row.authMethod}.`,
        });
      }
      replacement = buildSecretPayload({
        authMethod: row.authMethod,
        secret: args.secret,
      });
    }
    if (args.envName !== undefined) {
      if (row.authMethod !== 'env') {
        throw new ConvexError({
          code: 'CREDENTIAL_SHAPE_INVALID',
          message: `An env name applies to env credentials; this one is ${row.authMethod}.`,
        });
      }
      replacement = buildSecretPayload({
        authMethod: 'env',
        envName: args.envName,
      });
    }
    if (args.broker !== undefined) {
      if (row.authMethod !== 'subscription-broker') {
        throw new ConvexError({
          code: 'CREDENTIAL_SHAPE_INVALID',
          message: `A broker configuration applies to subscription-broker credentials; this one is ${row.authMethod}.`,
        });
      }
      const broker = parseBrokerData(args.broker);
      // Keep the stored broker secret when the new payload omits it. A
      // rotation-orphaned envelope is unrecoverable either way; resolution
      // will surface the actionable re-enter error.
      if (broker.authSecret === undefined && row.encryptedData) {
        try {
          const previous = brokerCredentialDataSchema.parse(
            JSON.parse(decryptSecret(row.encryptedData)),
          );
          if (previous.authSecret !== undefined) {
            broker.authSecret = previous.authSecret;
          }
        } catch (err) {
          if (!(err instanceof KeyRotatedError)) throw err;
          console.warn(
            '[provider-credentials] stored broker data was encrypted under a rotated key; saving the new configuration without a broker secret.',
          );
        }
      }
      replacement = {
        encryptedData: encryptSecret(JSON.stringify(broker)),
        ...(broker.authSecret !== undefined && {
          maskedPreview: maskSecret(broker.authSecret),
        }),
      };
    }

    await ctx.runMutation(
      internal.provider_credentials.mutations.patchCredentialInternal,
      {
        organizationId: args.organizationId,
        credentialId: args.credentialId,
        ...(args.name !== undefined && { name: args.name }),
        ...(args.modelAllowlist !== undefined && {
          modelAllowlist: args.modelAllowlist,
        }),
        ...(args.status !== undefined && { status: args.status }),
        ...(args.isDefault !== undefined && { isDefault: args.isDefault }),
        ...(endpointReplacement !== undefined && {
          endpointUrl: endpointReplacement,
        }),
        ...replacement,
      },
    );
    return null;
  },
});
