'use node';

/**
 * Enterprise SSO file utilities — per organization.
 *
 * The org's single SSO connection is the source of truth on disk, alongside the
 * governance policies under the org's own subtree:
 *   {TALE_CONFIG_DIR}/<orgSlug>/governance/sso/connection.yml           (config)
 *   {TALE_CONFIG_DIR}/<orgSlug>/governance/sso/connection.secrets.json  (secrets)
 *
 * `connection.json` remains readable as the pre-conversion fallback (org
 * trees are converted `.json`→`.yml` by a versioned node migration); writes
 * emit `.yml` and supersede the `.json` sibling. The secrets sidecar keeps
 * the `.secrets.json` name and format — secrets sidecars are deliberately
 * NOT part of the YAML conversion (see `config/file_actions.ts`).
 *
 * The non-secret connection file is mirrored into the generic `configCache`
 * table (domain `sso`, key `connection`) so V8 code can read it; the plaintext
 * secrets sidecar (clientId / clientSecret / spPrivateKey) is read only by
 * the `'use node'` sign-in adapters — the filesystem is the trust boundary,
 * exactly like the provider secrets sidecars.
 *
 * Pure path + (de)serialization helpers. No Convex dependencies. The reads /
 * writes themselves live in `config/file_actions.ts`.
 */

import { stringifyYaml } from '../../../lib/shared/config/yaml';
import {
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
  type SsoConnectionFile,
  ssoConnectionFileSchema,
  type SsoConnectionSecrets,
  ssoConnectionSecretsSchema,
} from '../../../lib/shared/schemas/enterprise_sso';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import { resolveGovernanceDir } from '../governance/file_utils';
import { safeJoinWithinDir } from '../lib/file_io';

export type { SsoConnectionFile, SsoConnectionSecrets };
export { SSO_CONFIG_DOMAIN, SSO_CONNECTION_KEY };

export const MAX_FILE_SIZE_BYTES = 64 * 1024; // 64 KB

/** `<orgSlug>/governance/sso/` — the org's SSO config directory. */
export function resolveSsoDir(orgSlug: string): string {
  return safeJoinWithinDir(resolveGovernanceDir(orgSlug), SSO_CONFIG_DOMAIN);
}

/** `<orgSlug>/governance/sso/connection.json` — the pre-conversion format,
 *  kept for the historical SSO cutover migration and the superseded-sibling
 *  cleanup; live writes target {@link resolveSsoConnectionYamlFilePath}. */
export function resolveSsoConnectionFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveSsoDir(orgSlug),
    `${SSO_CONNECTION_KEY}.json`,
  );
}

/** `<orgSlug>/governance/sso/connection.yml` — canonical write target. */
export function resolveSsoConnectionYamlFilePath(orgSlug: string): string {
  return safeJoinWithinDir(resolveSsoDir(orgSlug), `${SSO_CONNECTION_KEY}.yml`);
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

/** Serialize the connection config to its canonical `.yml` on-disk form. */
export function serializeSsoConnectionYaml(config: SsoConnectionFile): string {
  return stringifyYaml(ssoConnectionFileSchema.parse(config));
}

/** Validate already-parsed connection data (the yml-then-json reader hands
 *  over plain data, not text). Throws on invalid input. */
export function validateSsoConnectionData(data: unknown): SsoConnectionFile {
  const result = ssoConnectionFileSchema.safeParse(data);
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
