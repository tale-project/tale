'use node';

/**
 * Credential resolution — the ONE internal seam that turns a provider
 * credential row into usable secret material, for the chat pipeline, the
 * gateway provisioner, and sandbox session setup. `'use node'` by necessity
 * (secret_box decryption, `process.env`, the broker fetch) and INTERNAL by
 * contract: callers must never echo the returned values to clients, agents,
 * or logs.
 *
 * Resolution by auth method (exhaustive):
 *
 *  - `api-key` — decrypt the stored secret; a key-rotation mismatch surfaces
 *    as an actionable "re-enter the secret", never a bare crypto error.
 *  - `env` — read the deployment variable named by the row, re-checking the
 *    `TALE_PROVIDER_KEY_` prefix gate at READ time (fail-closed even if a
 *    row predates or bypassed save-time validation).
 *  - `subscription-broker` — decrypt the broker config, fetch the token pool
 *    through the SSRF-guarded client, map/filter it with the pure core
 *    (`broker_pool.ts`), and pick one token; an empty pool carries a
 *    diagnosis naming the mapping piece that dropped everything.
 *
 * Failures never include the broker URL, response bodies, or any secret —
 * only failure classes and actionable hints.
 */

import { z } from 'zod/v4';

import { AppError } from '../../lib/shared/errors/app-error';
import {
  BROKER_SECRET_ENV_REGEX,
  brokerCredentialDataSchema,
  SECRETS_ENV_REGEX,
  type BrokerCredentialData,
} from '../../lib/shared/schemas/providers';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { safeFetch, SafeFetchError } from '../lib/http/safe_fetch';
import type { Id } from '../lib/rows';
import {
  decryptSecret,
  KeyRotatedError,
  type EncryptedSecret,
} from '../lib/secret_box';
import {
  buildBrokerAuthHeaders,
  describeEmptyPool,
  diagnoseTokenMapping,
  pickToken,
} from './broker_pool';
import { filterBrokerTokensByHash } from './token_hash';

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
  endpointUrl?: string;
  status: 'active' | 'disabled';
}

export interface ResolveCredentialArgs {
  readonly organizationId: string;
  readonly providerSlug: string;
  /** Explicit credential; omitted means the (org, provider) default. */
  readonly credentialId?: Id<'providerCredentials'>;
  /** Broker tokens already tried this turn — rotation always advances to a
   * fresh one. Ignored for the other auth methods. */
  readonly excludeBrokerTokens?: readonly string[];
  /** sha256 hex of broker tokens a failure streak already burned
   * (`hashBrokerToken` stamps on the run rows) — the pick advances past
   * them. Softer than `excludeBrokerTokens`: when the exclusions would empty
   * the pool, the pick falls back to the FULL pool instead of refusing — a
   * one-account deployment must retry on its only account, not starve
   * itself. Ignored for the other auth methods. */
  readonly excludeBrokerTokenHashes?: readonly string[];
}

export type ResolvedProviderCredential =
  | {
      readonly authMethod: 'api-key';
      readonly credentialId: Id<'providerCredentials'>;
      readonly name: string;
      readonly secret: string;
      /** Per-credential wire endpoint (Azure-style providers). */
      readonly endpointUrl?: string;
    }
  | {
      readonly authMethod: 'env';
      readonly credentialId: Id<'providerCredentials'>;
      readonly name: string;
      readonly envName: string;
      readonly secret: string;
      /** Per-credential wire endpoint (Azure-style providers). */
      readonly endpointUrl?: string;
    }
  | {
      /** A static vendor subscription secret. Its forced harness lives on
       * the CONNECTOR's auth entry — execution resolution reads it there;
       * this result only carries the material. */
      readonly authMethod: 'subscription-key';
      readonly credentialId: Id<'providerCredentials'>;
      readonly name: string;
      readonly secret: string;
    }
  | {
      readonly authMethod: 'subscription-broker';
      readonly credentialId: Id<'providerCredentials'>;
      readonly name: string;
      /** The picked pool token — inject under `targetEnvVar`. */
      readonly token: string;
      readonly targetEnvVar: string;
      /** Usable pool size at fetch time, for rotation bookkeeping. */
      readonly poolSize: number;
      /** The row's endpoint override, when the brokered token authenticates
       * against a proxy instead of the vendor's default API host. */
      readonly endpointUrl?: string;
    };

type CredentialError = AppError<{ code: string; message: string }>;

function credentialError(code: string, message: string): CredentialError {
  return new AppError({ code, message });
}

/** Decrypt with the rotation mismatch mapped to an actionable refusal. */
function decryptOrExplain(row: CredentialRow, data: EncryptedSecret): string {
  try {
    return decryptSecret(data);
  } catch (err) {
    if (err instanceof KeyRotatedError) {
      throw credentialError(
        'CREDENTIAL_KEY_ROTATED',
        `Credential "${row.name}" was encrypted under a previous ENCRYPTION_SECRET_HEX and cannot be decrypted — re-enter the secret in Settings → AI providers.`,
      );
    }
    throw err;
  }
}

/** Load the addressed row (explicit id, else the pair's default), verifying
 * tenant and provider. A row of another org reads as not-found. */
async function loadRow(
  ctx: ActionCtx,
  args: ResolveCredentialArgs,
): Promise<CredentialRow> {
  if (args.credentialId !== undefined) {
    const row: CredentialRow | null = await ctx.runQuery(
      internal.provider_credentials.queries.getCredentialInternal,
      { credentialId: args.credentialId },
    );
    if (!row || row.organizationId !== args.organizationId) {
      throw credentialError('CREDENTIAL_NOT_FOUND', 'Credential not found.');
    }
    if (row.providerSlug !== args.providerSlug) {
      throw credentialError(
        'CREDENTIAL_PROVIDER_MISMATCH',
        `Credential "${row.name}" belongs to provider "${row.providerSlug}", not "${args.providerSlug}".`,
      );
    }
    return row;
  }
  const fallback: CredentialRow | null = await ctx.runQuery(
    internal.provider_credentials.queries.getDefaultCredentialInternal,
    {
      organizationId: args.organizationId,
      providerSlug: args.providerSlug,
    },
  );
  if (!fallback) {
    throw credentialError(
      'CREDENTIAL_NONE_CONFIGURED',
      `No default credential is configured for provider "${args.providerSlug}" — add one in Settings → AI providers, or select a credential explicitly.`,
    );
  }
  return fallback;
}

/** A row whose secret fields don't match its method cannot be resolved. */
function shapeError(row: CredentialRow): CredentialError {
  return credentialError(
    'CREDENTIAL_SHAPE_INVALID',
    `Credential "${row.name}" is missing its ${row.authMethod} payload — delete and recreate it.`,
  );
}

/** The broker's own auth secret: the stored value wins, else the operator
 * env-ref (prefix-gated). Undefined when neither is configured. */
function brokerAuthSecret(broker: BrokerCredentialData): string | undefined {
  if (broker.authSecret !== undefined) return broker.authSecret;
  if (broker.auth.method === 'none') return undefined;
  const envRef = broker.auth.secretEnv;
  if (envRef === undefined || !BROKER_SECRET_ENV_REGEX.test(envRef)) {
    return undefined;
  }
  const value = process.env[envRef]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Fetch the broker's token pool through the SSRF-guarded client. Thin by
 * design: config in, parsed JSON out; every failure is classified without
 * echoing the URL, headers, or body.
 */
async function fetchBrokerJson(
  row: CredentialRow,
  broker: BrokerCredentialData,
): Promise<unknown> {
  let response;
  try {
    response = await safeFetch(broker.endpoint, {
      method: broker.httpMethod,
      headers: buildBrokerAuthHeaders(broker.auth, brokerAuthSecret(broker)),
      timeoutMs: broker.timeoutMs,
      maxResponseBytes: broker.maxResponseBytes,
    });
  } catch (err) {
    const kind = err instanceof SafeFetchError ? err.kind : 'network_error';
    throw credentialError(
      'CREDENTIAL_BROKER_FETCH_FAILED',
      `The token broker behind credential "${row.name}" could not be reached (${kind}) — check the endpoint and the broker's availability.`,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw credentialError(
      'CREDENTIAL_BROKER_FETCH_FAILED',
      `The token broker behind credential "${row.name}" returned HTTP ${response.status}.`,
    );
  }
  try {
    return JSON.parse(response.body);
  } catch {
    throw credentialError(
      'CREDENTIAL_BROKER_FETCH_FAILED',
      `The token broker behind credential "${row.name}" returned a non-JSON response.`,
    );
  }
}

async function resolveBroker(
  row: CredentialRow,
  args: ResolveCredentialArgs,
): Promise<ResolvedProviderCredential> {
  if (!row.encryptedData) throw shapeError(row);
  let broker: BrokerCredentialData;
  try {
    broker = brokerCredentialDataSchema.parse(
      JSON.parse(decryptOrExplain(row, row.encryptedData)),
    );
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      throw shapeError(row);
    }
    throw err;
  }

  const json = await fetchBrokerJson(row, broker);
  const diagnostics = diagnoseTokenMapping(
    json,
    broker.responseMapping,
    Date.now(),
    broker.expirySkewMs,
  );
  if (diagnostics.usableTokens.length === 0) {
    throw credentialError(
      'CREDENTIAL_BROKER_EMPTY',
      `The token broker behind credential "${row.name}" yielded no usable tokens: ${describeEmptyPool(diagnostics, broker.responseMapping)}`,
    );
  }
  // Hash-based exclusion (a retry steering away from the streak's burned
  // accounts) is advisory: when it would empty the pool, fall back to the
  // full pool — retrying the only account beats not retrying at all.
  const excludedHashes = new Set(args.excludeBrokerTokenHashes ?? []);
  const { candidates, fellBack } = filterBrokerTokensByHash(
    diagnostics.usableTokens,
    excludedHashes,
  );
  if (fellBack) {
    console.warn(
      `[credentials] broker "${row.name}": every usable token (pool size ${diagnostics.usableTokens.length}, ${excludedHashes.size} hash exclusion(s)) was already tried by the failure streak — falling back to the full pool`,
    );
  }
  const token = pickToken(
    candidates,
    new Set(args.excludeBrokerTokens ?? []),
    broker.selection,
  );
  if (token === null) {
    throw credentialError(
      'CREDENTIAL_BROKER_EXHAUSTED',
      `Every token in the pool behind credential "${row.name}" was already tried this turn (${diagnostics.usableTokens.length} token(s)).`,
    );
  }
  return {
    authMethod: 'subscription-broker',
    credentialId: row._id,
    name: row.name,
    token,
    targetEnvVar: broker.targetEnvVar,
    poolSize: diagnostics.usableTokens.length,
    ...(row.endpointUrl !== undefined ? { endpointUrl: row.endpointUrl } : {}),
  };
}

/**
 * Resolve one (org, provider[, credential]) selection to its usable secret
 * material. Internal-only: callers own keeping the result out of logs and
 * client responses.
 */
export async function resolveProviderCredential(
  ctx: ActionCtx,
  args: ResolveCredentialArgs,
): Promise<ResolvedProviderCredential> {
  const row = await loadRow(ctx, args);
  if (row.status === 'disabled') {
    throw credentialError(
      'CREDENTIAL_DISABLED',
      `Credential "${row.name}" is disabled — enable it in Settings → AI providers, or pick another credential.`,
    );
  }
  switch (row.authMethod) {
    case 'api-key': {
      if (!row.encryptedData) throw shapeError(row);
      return {
        authMethod: 'api-key',
        credentialId: row._id,
        name: row.name,
        secret: decryptOrExplain(row, row.encryptedData),
        ...(row.endpointUrl !== undefined && {
          endpointUrl: row.endpointUrl,
        }),
      };
    }
    case 'subscription-key': {
      // A static vendor subscription secret — decrypted like an api key;
      // the forced-harness constraints live on the provider's auth entry
      // and are applied by execution resolution, never here.
      if (!row.encryptedData) throw shapeError(row);
      return {
        authMethod: 'subscription-key',
        credentialId: row._id,
        name: row.name,
        secret: decryptOrExplain(row, row.encryptedData),
      };
    }
    case 'env': {
      const envName = row.envName;
      if (envName === undefined) throw shapeError(row);
      // Fail-closed read gate: never dereference a name outside the reserved
      // namespace, whatever the row claims.
      if (!SECRETS_ENV_REGEX.test(envName)) {
        throw credentialError(
          'CREDENTIAL_ENV_NAME_INVALID',
          `Credential "${row.name}" names the env var "${envName}", which is outside the TALE_PROVIDER_KEY_ namespace — recreate the credential with a prefixed name.`,
        );
      }
      const value = process.env[envName]?.trim();
      if (value === undefined || value === '') {
        throw credentialError(
          'CREDENTIAL_ENV_UNSET',
          `The env var "${envName}" behind credential "${row.name}" is empty or unset on this deployment — set it and restart, or use a different credential.`,
        );
      }
      return {
        authMethod: 'env',
        credentialId: row._id,
        name: row.name,
        envName,
        secret: value,
        ...(row.endpointUrl !== undefined && {
          endpointUrl: row.endpointUrl,
        }),
      };
    }
    case 'subscription-broker':
      return await resolveBroker(row, args);
    default: {
      const _exhaustive: never = row.authMethod;
      return _exhaustive;
    }
  }
}
