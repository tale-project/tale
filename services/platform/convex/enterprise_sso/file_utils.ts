'use node';

/**
 * Enterprise SSO JSON file utilities — per organization.
 *
 * The org's single SSO connection is the source of truth on disk, alongside the
 * governance policies under the org's own subtree:
 *   {TALE_CONFIG_DIR}/<orgSlug>/governance/sso/connection.json          (config)
 *   {TALE_CONFIG_DIR}/<orgSlug>/governance/sso/connection.secrets.json  (secrets)
 *
 * The non-secret `connection.json` is mirrored into the generic `configCache`
 * table (domain `sso`, key `connection`) so V8 code can read it; the plaintext
 * `connection.secrets.json` sidecar (clientId / clientSecret / spPrivateKey) is
 * read only by the `'use node'` sign-in adapters — the filesystem is the trust
 * boundary, exactly like `providers/*.secrets.json`.
 *
 * Pure path + (de)serialization helpers. No Convex dependencies. The reads /
 * writes themselves live in `config/file_actions.ts`.
 */

import {
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
  type SsoConnectionFile,
  ssoConnectionFileSchema,
  type SsoConnectionSecrets,
  ssoConnectionSecretsSchema,
} from '../../lib/shared/schemas/enterprise_sso';
import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import { resolveGovernanceDir } from '../governance/file_utils';
import { safeJoinWithinDir } from '../lib/file_io';

export type { SsoConnectionFile, SsoConnectionSecrets };
export { SSO_CONFIG_DOMAIN, SSO_CONNECTION_KEY };

export const MAX_FILE_SIZE_BYTES = 64 * 1024; // 64 KB

/** `<orgSlug>/governance/sso/` — the org's SSO config directory. */
export function resolveSsoDir(orgSlug: string): string {
  return safeJoinWithinDir(resolveGovernanceDir(orgSlug), SSO_CONFIG_DOMAIN);
}

/** `<orgSlug>/governance/sso/connection.json` — non-secret connection config. */
export function resolveSsoConnectionFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveSsoDir(orgSlug),
    `${SSO_CONNECTION_KEY}.json`,
  );
}

/** `<orgSlug>/governance/sso/connection.secrets.json` — plaintext secrets sidecar. */
export function resolveSsoConnectionSecretsFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveSsoDir(orgSlug),
    `${SSO_CONNECTION_KEY}.secrets.json`,
  );
}

/** `<orgSlug>/governance/sso/.history/connection` — config history snapshots. */
export function resolveSsoHistoryDir(orgSlug: string): string {
  return safeJoinWithinDir(
    safeJoinWithinDir(resolveSsoDir(orgSlug), '.history'),
    SSO_CONNECTION_KEY,
  );
}

/**
 * Serialize the connection config to its canonical on-disk form. Uses a direct
 * `JSON.stringify` (not the `serializeJson` helper) so the schema-required empty
 * arrays (`oidc.scopes`, `provisioning.roleMappingRules`/`excludeGroups`) are
 * preserved, and applies schema defaults via `parse`.
 */
export function serializeSsoConnectionJson(config: SsoConnectionFile): string {
  return JSON.stringify(ssoConnectionFileSchema.parse(config), null, 2) + '\n';
}

/** Parse + validate `connection.json`. Throws on invalid input. */
export function parseSsoConnectionJson(content: string): SsoConnectionFile {
  const parsed: unknown = JSON.parse(content);
  const result = ssoConnectionFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid SSO connection config', result.error),
    );
  }
  return result.data;
}

/** Serialize the secrets sidecar (no defaults; omit absent keys). */
export function serializeSsoSecretsJson(secrets: SsoConnectionSecrets): string {
  return (
    JSON.stringify(ssoConnectionSecretsSchema.parse(secrets), null, 2) + '\n'
  );
}

/** Parse + validate `connection.secrets.json`. Throws on invalid input. */
export function parseSsoSecretsJson(content: string): SsoConnectionSecrets {
  const parsed: unknown = JSON.parse(content);
  const result = ssoConnectionSecretsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(zodErrorMessage('Invalid SSO secrets file', result.error));
  }
  return result.data;
}
