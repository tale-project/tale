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

import { isPrivateIp } from '@tale/shared/net/private-ip';
import {
  BROKER_SECRET_ENV_REGEX,
  brokerCredentialDataSchema,
  SECRETS_ENV_REGEX,
  type BrokerCredentialData,
} from '@tale/shared/schemas/providers';
import { z } from 'zod/v4';

import {
  checkProviderHostPolicy,
  privateProviderHostsAllowed,
} from '../../../lib/net/host-policy';
import { safeFetch, SafeFetchError } from '../../../lib/net/safe-fetch';
import { AppError } from '../../../lib/shared/errors/app-error';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
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
  type BrokerSelectionResult,
} from './broker_pool';
import { hashBrokerAccount, hashBrokerToken } from './token_hash';

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
  /** Account hashes a failure streak already burned (legacy token hashes
   * are also accepted). Advisory when every eligible account was tried;
   * fallback never bypasses quota unavailability or a shared cooldown.
   * Ignored for the other auth methods. */
  readonly excludeBrokerTokenHashes?: readonly string[];
  /** Set by a harness whose vendor protocol requires an account header. */
  readonly requireBrokerAccountId?: boolean;
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
      /** Stable broker account hash, falling back to the token for old pools. */
      readonly brokerTokenHash: string;
      /** Vendor account id, independent from the broker's stable identity. */
      readonly accountId?: string;
      /** The row's endpoint override, when the brokered token authenticates
       * against a proxy instead of the vendor's default API host. */
      readonly endpointUrl?: string;
    };

type CredentialError = AppError<{ code: string; message: string }>;

/**
 * The resolver's refusal code carried by an error (`CREDENTIAL_NOT_FOUND`,
 * `CREDENTIAL_NONE_CONFIGURED`, …), or null when the error is not one of
 * its refusals. Duck-typed on `data.code`: the callers that turn a refusal
 * into a stable platform answer (indexing, search, the chat assistant) may
 * hold another copy of `AppError`.
 */
export function credentialRefusalCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('data' in error)) {
    return null;
  }
  const data = error.data;
  if (data === null || typeof data !== 'object' || !('code' in data)) {
    return null;
  }
  const code = data.code;
  return typeof code === 'string' && code.startsWith('CREDENTIAL_')
    ? code
    : null;
}

/**
 * The refusals no wait lifts: the selection names nothing usable (deleted,
 * of another provider, no default left), or the row cannot yield its secret
 * (disabled, encrypted under a rotated key, an env var that is unset or
 * outside the namespace, a payload missing for its method). An admin fixes
 * each one — in Settings → AI providers, or on the deployment — and every
 * retry until then answers the same refusal. An allowlist, so a refusal
 * added later is not terminal until someone says so. The broker's own
 * refusals stay out: an exhausted pool cools down
 * (`CREDENTIAL_BROKER_EXHAUSTED`) and an unreachable broker comes back
 * (`CREDENTIAL_BROKER_FETCH_FAILED`).
 */
const TERMINAL_CREDENTIAL_REFUSALS: ReadonlySet<string> = new Set([
  'CREDENTIAL_NOT_FOUND',
  'CREDENTIAL_NONE_CONFIGURED',
  'CREDENTIAL_PROVIDER_MISMATCH',
  'CREDENTIAL_DISABLED',
  'CREDENTIAL_KEY_ROTATED',
  'CREDENTIAL_SHAPE_INVALID',
  'CREDENTIAL_ENV_NAME_INVALID',
  'CREDENTIAL_ENV_UNSET',
]);

/** Whether a resolver refusal holds until an admin acts (see
 * {@link TERMINAL_CREDENTIAL_REFUSALS}). */
export function isTerminalCredentialRefusal(error: unknown): boolean {
  const code = credentialRefusalCode(error);
  return code !== null && TERMINAL_CREDENTIAL_REFUSALS.has(code);
}

/**
 * When a broker pool that refused because every account was cooling down
 * after a rate limit (`CREDENTIAL_BROKER_EXHAUSTED`) has its first account
 * back — epoch ms — or undefined for any other error. A caller that retries
 * the work can wait for it instead of being refused again at once.
 */
export function credentialRetryAtMs(error: unknown): number | undefined {
  if (
    credentialRefusalCode(error) !== 'CREDENTIAL_BROKER_EXHAUSTED' ||
    error === null ||
    typeof error !== 'object' ||
    !('data' in error)
  ) {
    return undefined;
  }
  const data = error.data;
  if (data === null || typeof data !== 'object' || !('retryAtMs' in data)) {
    return undefined;
  }
  const retryAtMs = data.retryAtMs;
  return typeof retryAtMs === 'number' && Number.isFinite(retryAtMs)
    ? retryAtMs
    : undefined;
}

/** The resolver's own sentence for a refusal — the remedy it names, never a
 * secret — or null when the error is not one of its refusals. `AppError`
 * serializes its whole payload into `message`, so this reads `data`. */
export function credentialRefusalMessage(error: unknown): string | null {
  if (
    credentialRefusalCode(error) === null ||
    error === null ||
    typeof error !== 'object' ||
    !('data' in error)
  ) {
    return null;
  }
  const data = error.data;
  if (data === null || typeof data !== 'object' || !('message' in data)) {
    return null;
  }
  const message = data.message;
  return typeof message === 'string' && message.trim() !== '' ? message : null;
}

function credentialError(
  code: string,
  message: string,
  extra: { retryAtMs?: number } = {},
): CredentialError {
  return new AppError({ code, message, ...extra });
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
 * The deployment's outbound-host policy over the broker endpoint, applied
 * at every resolution: cloud-metadata hosts are refused unconditionally and
 * private hosts unless the operator opted in — exactly the gate every other
 * operator-URL fetch runs. `safeFetch` alone cannot stand in for it: its
 * auto-derived own-host allowlist admits the initial URL's host, so its
 * private-IP refusal never fires for the URL it was handed. An org admin is
 * not the deployment operator, so a broker aimed at `169.254.169.254` must
 * die here, before any request. Returns the hosts `safeFetch` must
 * additionally allow (a policy-admitted private host), else `undefined`.
 */
function policeBrokerEndpoint(
  row: CredentialRow,
  endpoint: string,
): readonly string[] | undefined {
  let hostname: string;
  try {
    hostname = checkProviderHostPolicy(endpoint).hostname;
  } catch (err) {
    if (err instanceof AppError) {
      throw credentialError(
        'CREDENTIAL_BROKER_ENDPOINT_BLOCKED',
        `The token broker endpoint behind credential "${row.name}" is refused by this deployment's host policy: ${err.message}`,
      );
    }
    throw err;
  }
  return isPrivateIp(hostname) ? [hostname] : undefined;
}

/**
 * Fetch the broker's token pool through the SSRF-guarded client, after the
 * host policy admitted the endpoint. Thin by design: config in, parsed JSON
 * out; every failure is classified without echoing the URL, headers, or
 * body.
 */
async function fetchBrokerJson(
  row: CredentialRow,
  broker: BrokerCredentialData,
): Promise<unknown> {
  const allowedHosts = policeBrokerEndpoint(row, broker.endpoint);
  let response;
  try {
    response = await safeFetch(broker.endpoint, {
      allowPrivateAddresses: privateProviderHostsAllowed(),
      method: broker.httpMethod,
      headers: buildBrokerAuthHeaders(broker.auth, brokerAuthSecret(broker)),
      timeoutMs: broker.timeoutMs,
      maxResponseBytes: broker.maxResponseBytes,
      ...(allowedHosts !== undefined
        ? { allowedHosts: [...allowedHosts] }
        : {}),
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
  ctx: ActionCtx,
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
    args.providerSlug === 'openai' || args.providerSlug === 'anthropic'
      ? args.providerSlug
      : undefined,
    args.requireBrokerAccountId ?? args.providerSlug === 'openai',
  );
  // An account the broker holds back only for its coming refresh is a
  // fallback, never part of the usable pool (`selectBrokerAccount`).
  const pool = [
    ...diagnostics.usableAccounts.map((account) => ({ account, held: false })),
    ...diagnostics.heldAccounts.map((account) => ({ account, held: true })),
  ];
  if (pool.length === 0) {
    throw credentialError(
      'CREDENTIAL_BROKER_EMPTY',
      `The token broker behind credential "${row.name}" yielded no usable tokens: ${describeEmptyPool(diagnostics, broker.responseMapping)}`,
    );
  }
  // Hash exclusions remain advisory, but only after hard availability and
  // cooldown filters. Keep the legacy token hash compatible with old runs.
  const excludedHashes = new Set(args.excludeBrokerTokenHashes ?? []);
  const excludedTokens = new Set(args.excludeBrokerTokens ?? []);
  const byHash = new Map(
    pool
      .filter(({ account }) => !excludedTokens.has(account.token))
      .map((entry) => [hashBrokerAccount(row._id, entry.account), entry]),
  );
  const selection: BrokerSelectionResult = await ctx.runMutation(
    internal.provider_credentials.mutations.selectBrokerAccountInternal,
    {
      organizationId: args.organizationId,
      credentialId: row._id,
      selection: broker.selection,
      candidates: [...byHash].map(([hash, { account, held }]) => {
        const excluded =
          excludedHashes.has(hash) ||
          excludedHashes.has(hashBrokerToken(account.token));
        return held ? { hash, excluded, held } : { hash, excluded };
      }),
    },
  );
  if (selection.fellBack) {
    console.warn(
      `[credentials] broker "${row.name}": retry exclusions cover every currently eligible account — reusing an eligible account`,
    );
  }
  if (selection.held === true) {
    console.warn(
      `[credentials] broker "${row.name}": every account the broker counts as available is cooling down or unusable here — using one it holds back for its coming token refresh`,
    );
  }
  const account =
    selection.hash === null ? undefined : byHash.get(selection.hash)?.account;
  if (account === undefined || selection.hash === null) {
    throw selection.retryAtMs !== undefined
      ? credentialError(
          'CREDENTIAL_BROKER_EXHAUSTED',
          `Every account behind credential "${row.name}" is cooling down after a rate limit — try again in ${Math.max(1, Math.ceil((selection.retryAtMs - Date.now()) / 1000))} seconds.`,
          { retryAtMs: selection.retryAtMs },
        )
      : credentialError(
          'CREDENTIAL_BROKER_EXHAUSTED',
          `Every token in the pool behind credential "${row.name}" was already tried this turn (${pool.length} token(s)).`,
        );
  }
  return {
    authMethod: 'subscription-broker',
    credentialId: row._id,
    name: row.name,
    token: account.token,
    brokerTokenHash: selection.hash,
    targetEnvVar: broker.targetEnvVar,
    ...(account.accountId !== undefined && { accountId: account.accountId }),
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
      return await resolveBroker(ctx, row, args);
    default: {
      const _exhaustive: never = row.authMethod;
      return _exhaustive;
    }
  }
}
