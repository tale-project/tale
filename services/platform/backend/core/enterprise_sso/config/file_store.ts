'use node';

/**
 * File store for the org's SSO connection — the read/snapshot/write
 * mechanics shared by the 0.4 `'use node'` file actions and the 0.5
 * backend's admin surface. Callers still own the configCache mirror (0.4)
 * and the audit row; the only thing the writers take is `sql`, and only to
 * hold the governance domain's write lock across their two-file commit (see
 * `withConfigWriteLock`). The pragma matters to the CONVEX bundler only
 * (every file under convex/ is an entry point, partitioned by its own
 * pragma — a pragma-less file with `node:*` imports breaks the V8 bundle);
 * the 0.5 node-loader treats it as inert.
 *
 * Layout (files are the source of truth):
 *   <orgSlug>/governance/sso/connection.yml           (non-secret config)
 *   <orgSlug>/governance/sso/connection.secrets.json  (plaintext secrets)
 * Writes snapshot the current file into history first, emit the canonical
 * `connection.yml`, delete the superseded pre-conversion `.json` sibling,
 * and rewrite the secrets sidecar (reused-on-omit is the CALLER's rule).
 */

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import {
  type SsoConnectionFile,
  type SsoConnectionSecrets,
} from '../../../../lib/shared/schemas/enterprise_sso';
import { readDomainConfigFile } from '../../lib/config_store/read_domain_file';
import { withConfigWriteLock } from '../../lib/config_store/write_lock';
import {
  atomicWrite,
  atomicWriteSecret,
  errnoCode,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeFileSafe,
} from '../../lib/file_io';
import {
  MAX_FILE_SIZE_BYTES,
  parseSsoSecretsJson,
  resolveSsoConnectionFilePath,
  resolveSsoConnectionSecretsFilePath,
  resolveSsoConnectionYamlFilePath,
  resolveSsoDir,
  resolveSsoHistoryDir,
  serializeSsoConnectionYaml,
  serializeSsoSecretsJson,
  SSO_CONNECTION_KEY,
  validateSsoConnectionData,
} from '../file_utils';

export const MAX_HISTORY_ENTRIES = 50;

export interface ExistingSsoFiles {
  config: SsoConnectionFile | null;
  secrets: SsoConnectionSecrets;
}

export async function readExisting(orgSlug: string): Promise<ExistingSsoFiles> {
  // yml first, json fallback — a corrupt file throws (writes must not
  // proceed as if no connection existed and clobber it).
  const configResult = await readDomainConfigFile(
    resolveSsoDir(orgSlug),
    SSO_CONNECTION_KEY,
    MAX_FILE_SIZE_BYTES,
    validateSsoConnectionData,
  );
  if (!configResult.ok && configResult.error !== 'not_found') {
    throw new Error(configResult.message);
  }
  const secretsRaw = await readFileSafe(
    resolveSsoConnectionSecretsFilePath(orgSlug),
  );
  return {
    config: configResult.ok ? configResult.data : null,
    secrets: secretsRaw ? parseSsoSecretsJson(secretsRaw) : {},
  };
}

/**
 * Snapshot → atomic write of both files. Writes the canonical
 * `connection.yml` and deletes the superseded `connection.json` only after
 * the write succeeded; the history snapshot keeps the current file's own
 * format under its own extension. The secrets sidecar stays `.secrets.json`.
 *
 * The whole sequence runs under the governance domain's write lock. A
 * connection is TWO files that have to move together: two writers
 * interleaving here commit one's `connection.yml` against the other's
 * secrets sidecar, and the deployment then authenticates against an identity
 * provider with a client id and a client secret from different saves. The
 * lock also makes the history snapshot a read-modify-write of one writer,
 * so a save cannot double-snapshot or prune a trail another is extending.
 */
export async function persistFiles(
  sql: Sql,
  orgSlug: string,
  config: SsoConnectionFile,
  secrets: SsoConnectionSecrets,
): Promise<void> {
  await withConfigWriteLock(sql, orgSlug, 'governance', async () => {
    const yamlPath = resolveSsoConnectionYamlFilePath(orgSlug);
    const jsonPath = resolveSsoConnectionFilePath(orgSlug);
    const currentYaml = await readFileSafe(yamlPath);
    const current = currentYaml ?? (await readFileSafe(jsonPath));
    if (current) {
      const historyDir = resolveSsoHistoryDir(orgSlug);
      await mkdir(historyDir, { recursive: true });
      await atomicWrite(
        path.join(
          historyDir,
          `${generateHistoryTimestamp()}.${currentYaml ? 'yml' : 'json'}`,
        ),
        current,
      );
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    }
    await atomicWrite(yamlPath, serializeSsoConnectionYaml(config));
    await removeFileSafe(jsonPath);
    await atomicWriteSecret(
      resolveSsoConnectionSecretsFilePath(orgSlug),
      serializeSsoSecretsJson(secrets),
    );
  });
}

/**
 * Remove the entire connection: config + secrets + history (both formats).
 * Takes the same lock as {@link persistFiles} — a delete racing a save must
 * not leave the secrets sidecar behind for the next connection to inherit.
 */
export async function removeConnectionFiles(
  sql: Sql,
  orgSlug: string,
): Promise<void> {
  await withConfigWriteLock(sql, orgSlug, 'governance', async () => {
    const ignoreMissing = (err: unknown) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    };
    await rm(resolveSsoConnectionYamlFilePath(orgSlug)).catch(ignoreMissing);
    await rm(resolveSsoConnectionFilePath(orgSlug)).catch(ignoreMissing);
    await rm(resolveSsoConnectionSecretsFilePath(orgSlug)).catch(ignoreMissing);
    await rm(resolveSsoHistoryDir(orgSlug), { recursive: true, force: true });
    await rm(resolveSsoDir(orgSlug), { force: true }).catch(() => {
      // Dir may be non-empty / shared; best-effort only.
    });
  });
}
