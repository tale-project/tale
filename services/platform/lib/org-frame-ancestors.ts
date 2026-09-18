import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  embeddingConfigSchema,
  frameAncestorsOf,
  policyTypeToFileBase,
} from '@tale/shared/schemas/governance';
import { parse as parseYaml } from 'yaml';

/**
 * The web origins allowed to embed this deployment's pages in a frame — the
 * union of every organization's enabled `embedding` governance policy
 * (`<TALE_CONFIG_DIR>/<orgSlug>/governance/embedding.yml`, `.json` fallback,
 * the file lane `tale config apply` and the settings card both write).
 *
 * The SPA shell is one document for every organization, so its CSP carries
 * the UNION: an origin one organization admits may load the shell; the
 * session inside the frame still decides what that origin's page can reach,
 * and the trusted-headers door judges its own response per organization.
 * Strict validation on purpose (the storage-origin scan is loose): these
 * values are interpolated into a response header, so an origin the schema
 * refuses is dropped with a warning rather than emitted.
 */

const EMBEDDING_FILE_BASE = policyTypeToFileBase('embedding');

/** True iff `err` is a Node ErrnoException with the given code. */
function isErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && 'code' in err && err.code === code;
}

function readPolicyFile(
  orgDir: string,
): { raw: string; format: 'yaml' | 'json' } | null {
  for (const candidate of [
    { file: `${EMBEDDING_FILE_BASE}.yml`, format: 'yaml' as const },
    { file: `${EMBEDDING_FILE_BASE}.json`, format: 'json' as const },
  ]) {
    const path = join(orgDir, 'governance', candidate.file);
    try {
      return { raw: readFileSync(path, 'utf8'), format: candidate.format };
    } catch (err) {
      // Almost every organization has no embedding policy — only warn on
      // anything other than the file simply not existing.
      if (!isErrnoCode(err, 'ENOENT')) {
        console.warn(`[org-frame-ancestors] cannot read ${path}`, err);
      }
    }
  }
  return null;
}

/**
 * Scan every organization's `embedding` policy under `configDir` and return
 * the deduplicated, sorted set of frame-ancestor origins. Missing files are
 * the norm; unreadable, unparsable or schema-refused files are skipped with
 * a warning — a broken organization config must not take the security
 * headers down with it, nor sneak an unvalidated value into them.
 */
export function collectOrgFrameAncestors(configDir: string): string[] {
  const origins = new Set<string>();
  let entries;
  try {
    entries = readdirSync(configDir, { withFileTypes: true });
  } catch (err) {
    console.warn(
      `[org-frame-ancestors] cannot read config dir ${configDir}`,
      err,
    );
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const orgDir = join(configDir, entry.name);
    const file = readPolicyFile(orgDir);
    if (file === null) continue;
    let parsed: unknown;
    try {
      parsed =
        file.format === 'yaml' ? parseYaml(file.raw) : JSON.parse(file.raw);
    } catch (err) {
      console.warn(
        `[org-frame-ancestors] invalid ${file.format} in ${entry.name}/governance/${EMBEDDING_FILE_BASE}`,
        err,
      );
      continue;
    }
    const config = embeddingConfigSchema.safeParse(parsed);
    if (!config.success) {
      console.warn(
        `[org-frame-ancestors] ${entry.name}/governance/${EMBEDDING_FILE_BASE} does not match the embedding policy; skipping`,
        config.error.issues.map((issue) => issue.message).join('; '),
      );
      continue;
    }
    for (const origin of frameAncestorsOf(config.data)) origins.add(origin);
  }
  return [...origins].sort();
}

/**
 * TTL-cached provider around `collectOrgFrameAncestors`, called on every
 * response by the security-header middleware — the same shape as the
 * storage-origin provider, for the same reasons: a handful of file reads,
 * rarely changing, and a short TTL keeps the window between "policy saved"
 * and "the frame loads" small without depending on the config watcher.
 *
 * A `null`/absent config dir yields a provider that always returns `[]`.
 */
export function createOrgFrameAncestorsProvider(
  configDir: string | null | undefined,
  ttlMs = 5000,
): () => readonly string[] {
  if (!configDir) return () => [];
  let cached: readonly string[] = [];
  let lastScanAt = -Infinity;
  return () => {
    const now = Date.now();
    if (now - lastScanAt >= ttlMs) {
      cached = collectOrgFrameAncestors(configDir);
      lastScanAt = now;
    }
    return cached;
  };
}
