'use node';

/**
 * Credential resolution — the ONE internal seam that turns an connector
 * credential row into usable secret material, for the workflow engine's
 * connector nodes and the chat tool surface. `'use node'` by necessity
 * (secret_box decryption, the connector catalog on disk) and INTERNAL by
 * contract: callers must never echo the returned values to clients, agents,
 * or logs.
 *
 * What comes back is exactly what an invocation needs and nothing more:
 *
 *  - `authHeader` — what the platform injects on the caller's behalf
 *    (`<scheme> <token>` for bearer, HTTP Basic for basic, `Bearer` for an
 *    oauth2 access token). Absent for `api-key`: those vendors want the
 *    secret somewhere of their own choosing, so the body places it.
 *  - `secrets` — the named values a live body reads through
 *    `ctx.secrets.get(<name>)`.
 *  - `endpoint` — the credential's own API origin, for connectors declaring
 *    `endpointMode: per-credential`.
 *
 * Every refusal is a typed `ConvexError` with an actionable message and no
 * secret material: a missing default, a credential the operator disabled, an
 * oauth2 grant whose refresh failed, and a key rotation that orphaned the
 * envelope each say what to do next, and say it differently.
 */

import { ConvexError } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import {
  decryptSecret,
  KeyRotatedError,
  type EncryptedSecret,
} from '../lib/secret_box';
import {
  buildAuthHeader,
  buildSecretBindings,
  parseSecretPayload,
  SecretPayloadError,
  type ConnectorSecretPayload,
} from './auth_injection';
import { connectorBearerScheme, findConnector } from './connector_catalog';

type ConnectorAuthMethodName = 'api-key' | 'bearer' | 'basic' | 'oauth2';

/** The full row shape the internal queries return (`returns: v.any()`
 * erases it on the wire). */
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
  statusDetail?: string;
}

export interface ResolveConnectorCredentialArgs {
  readonly organizationId: string;
  readonly connectorSlug: string;
  /**
   * The credential an invocation named — a credential id or its human name.
   * Omitted means the organization's default for this connector.
   */
  readonly credentialRef?: string;
}

export interface ResolvedConnectorCredential {
  readonly credentialId: Id<'connectorCredentials'>;
  readonly connectorSlug: string;
  readonly authMethod: ConnectorAuthMethodName;
  /** Named secrets a live body reads via `ctx.secrets.get(name)`. */
  readonly secrets: Record<string, string>;
  /** The credential's API origin, for per-credential-endpoint connectors. */
  readonly endpoint?: string;
  /** The connector's non-secret per-credential settings, passed to a live or
   * native body as `ctx.config`. Empty when the connector declares none. */
  readonly config: Record<string, string | number | boolean>;
  /** `Authorization` value the platform injects; absent for `api-key`. */
  readonly authHeader?: string;
}

type CredentialError = ConvexError<{ code: string; message: string }>;

function credentialError(code: string, message: string): CredentialError {
  return new ConvexError({ code, message });
}

/** Load the addressed row (explicit ref, else the pair's default). A row of
 * another org is never reachable — the lookup is scoped to the tenant. */
async function loadRow(
  ctx: ActionCtx,
  args: ResolveConnectorCredentialArgs,
): Promise<CredentialRow> {
  const row = (await ctx.runQuery(
    internal.connector_credentials.queries.resolveCredentialRefInternal,
    {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
    },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the internal query returns the full row as v.any(); this names its shape
  )) as CredentialRow | null;
  if (row) return row;
  if (args.credentialRef !== undefined) {
    throw credentialError(
      'CREDENTIAL_NOT_FOUND',
      `No credential "${args.credentialRef}" is configured for "${args.connectorSlug}" — check the name, or add it in Settings → Connectors.`,
    );
  }
  throw credentialError(
    'CREDENTIAL_NONE_CONFIGURED',
    `No default credential is configured for "${args.connectorSlug}" — add one in Settings → Connectors, or name a credential explicitly.`,
  );
}

/** Refuse a row the operator or the system took out of service, saying which
 * of the two it was and what fixes it. */
function assertUsable(row: CredentialRow): void {
  if (row.status === 'disabled') {
    throw credentialError(
      'CREDENTIAL_DISABLED',
      `Credential "${row.name}" is disabled — enable it in Settings → Connectors, or name another credential.`,
    );
  }
  if (row.status === 'needs-reauth') {
    const detail = row.statusDetail ? ` (${row.statusDetail})` : '';
    throw credentialError(
      'CREDENTIAL_NEEDS_REAUTH',
      `Credential "${row.name}" lost its authorization${detail} — reconnect "${row.connectorSlug}" in Settings → Connectors to restore access.`,
    );
  }
}

/** Decrypt and validate the row's envelope, mapping both failure modes onto
 * actionable refusals instead of a bare crypto or schema error. */
function openEnvelope(row: CredentialRow): ConnectorSecretPayload {
  let plaintext: string;
  try {
    plaintext = decryptSecret(row.encryptedData);
  } catch (err) {
    if (err instanceof KeyRotatedError) {
      throw credentialError(
        'CREDENTIAL_KEY_ROTATED',
        `Credential "${row.name}" was encrypted under a previous ENCRYPTION_SECRET_HEX and cannot be decrypted — re-enter it in Settings → Connectors.`,
      );
    }
    throw err;
  }
  try {
    return parseSecretPayload(row.authMethod, JSON.parse(plaintext));
  } catch (err) {
    if (err instanceof SecretPayloadError || err instanceof SyntaxError) {
      throw credentialError(
        'CREDENTIAL_SHAPE_INVALID',
        `Credential "${row.name}" does not carry a usable ${row.authMethod} payload — re-enter it in Settings → Connectors.`,
      );
    }
    throw err;
  }
}

/**
 * Resolve one (org, connector[, credential]) selection to the material an
 * invocation runs with. Internal-only: callers own keeping the result out of
 * logs and client responses.
 */
export async function resolveConnectorCredential(
  ctx: ActionCtx,
  args: ResolveConnectorCredentialArgs,
): Promise<ResolvedConnectorCredential> {
  const row = await loadRow(ctx, args);
  assertUsable(row);
  const payload = openEnvelope(row);
  // The bearer scheme is the CONNECTOR's decision (`Bearer` by default,
  // `Bot` for Discord), never the row's — a credential moved between
  // connectors would otherwise keep sending the wrong scheme.
  const connector = findConnector(row.connectorSlug);
  const authHeader = buildAuthHeader(
    payload,
    connector ? connectorBearerScheme(connector) : undefined,
  );
  return {
    credentialId: row._id,
    connectorSlug: row.connectorSlug,
    authMethod: row.authMethod,
    secrets: buildSecretBindings(payload),
    config: row.config ?? {},
    ...(row.endpointUrl !== undefined && { endpoint: row.endpointUrl }),
    ...(authHeader !== undefined && { authHeader }),
  };
}
