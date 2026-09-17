import { stat } from 'node:fs/promises';

import {
  POLICY_SCHEMAS,
  policyTypeToFileBase,
  type FilePolicyType,
} from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import { resolveGovernanceDir } from '../core/governance/file_utils.ts';
import { ConfigurationError } from '../core/lib/config_store/precondition.ts';
import { readDomainConfigFile } from '../core/lib/config_store/read_domain_file.ts';
import { getConfigRoot } from '../core/lib/file_io.ts';

/**
 * Per-org config reads for the 0.5 backend — files, read DIRECTLY.
 *
 * 0.4 mirrored config files into the `configCache` table purely because the
 * Convex V8 runtime could not touch the filesystem. The 0.5 backend is a
 * Node process, so the mirror layer dies: this module reads the same
 * `$TALE_CONFIG_DIR/<orgSlug>/<domain>/…` trees through the same shared
 * reader (`readDomainConfigFile`, YAML-first with `.json` fallback) with a
 * short in-process TTL cache. Deployment note (ledger): every api/worker
 * replica mounts the same config volume (RWX in K8s).
 */

const CACHE_TTL_MS = 15_000;
const MAX_POLICY_FILE_BYTES = 256 * 1024;

interface CacheEntry<T> {
  at: number;
  value: T;
}

const slugCache = new Map<string, CacheEntry<string | null>>();
const policyCache = new Map<string, CacheEntry<unknown>>();

/** Test hook: drop all caches so a test observes fresh reads. */
export function clearOrgConfigCaches(): void {
  slugCache.clear();
  policyCache.clear();
}

/**
 * Resolve an org's slug (config trees are keyed by slug, not id). Cached for
 * the TTL — slugs are mutable via org rename. Strict authorization readers
 * bypass this cache; other consumers retain the 0.4 configCache TTL posture.
 */
export async function resolveOrgSlug(
  sql: Sql | TransactionSql,
  organizationId: string,
  options: { fresh?: boolean } = {},
): Promise<string | null> {
  const cached = options.fresh ? undefined : slugCache.get(organizationId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  const rows = await sql<{ slug: string | null }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${organizationId} LIMIT 1
  `;
  const slug = rows[0]?.slug ?? null;
  slugCache.set(organizationId, { at: Date.now(), value: slug });
  return slug;
}

let warnedNoConfigDir = false;

function hasConfigRoot(): boolean {
  if (process.env.TALE_CONFIG_DIR) {
    return true;
  }
  if (!warnedNoConfigDir) {
    warnedNoConfigDir = true;
    console.warn(
      '[backend] TALE_CONFIG_DIR is not set — org config reads resolve to ' +
        'null and every governance policy falls back to its schema default.',
    );
  }
  return false;
}

/**
 * Read one governance policy file for an org slug. Returns the parsed
 * config, or null when the file is absent, the config root is unset, or the
 * file is corrupt (logged — a bad policy file must never brick the caller;
 * schema defaults apply, matching 0.4's `parseLoginPolicy` posture). Strict
 * callers instead refuse unreadable configuration and bypass the TTL cache.
 */
export interface ReadGovernancePolicyOptions {
  /** Skip the TTL cache and read the file as it is on disk right now — for
   * a writer recording what it is about to replace, where a value up to 15s
   * stale would put the wrong `previousState` on the audit row. */
  readonly fresh?: boolean;
  /** An authorization policy cannot substitute defaults for unreadable configuration.
   * Read both policy and org slug fresh, refuse an unavailable root/org or an
   * invalid file, and allow only a genuinely absent file to return null. */
  readonly strict?: boolean;
}

function governanceReadError(invalid = false): ConfigurationError {
  return new ConfigurationError(
    invalid ? 'GOVERNANCE_POLICY_INVALID' : 'GOVERNANCE_POLICY_UNAVAILABLE',
    'Governance policy is unavailable or invalid; restore valid configuration before retrying.',
    invalid ? 400 : 409,
  );
}

export async function readGovernancePolicy<T extends FilePolicyType>(
  orgSlug: string,
  policyType: T,
  options: ReadGovernancePolicyOptions = {},
): Promise<ReturnType<(typeof POLICY_SCHEMAS)[T]['parse']> | null> {
  if (!hasConfigRoot()) {
    if (options.strict) throw governanceReadError();
    return null;
  }
  const cacheKey = `${orgSlug}\0${policyType}`;
  const cached =
    options.fresh || options.strict ? undefined : policyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cache stores exactly what this function computed for this key
    return cached.value as ReturnType<
      (typeof POLICY_SCHEMAS)[T]['parse']
    > | null;
  }

  let value: unknown = null;
  try {
    if (
      options.strict &&
      !(await stat(getConfigRoot('governance'))).isDirectory()
    ) {
      throw governanceReadError();
    }
    const dir = resolveGovernanceDir(orgSlug);
    const result = await readDomainConfigFile(
      dir,
      policyTypeToFileBase(policyType),
      MAX_POLICY_FILE_BYTES,
      (data) => POLICY_SCHEMAS[policyType].parse(data),
    );
    if (result.ok) {
      value = result.data;
    } else if (result.error !== 'not_found') {
      if (options.strict)
        throw governanceReadError(result.error === 'corrupted');
      console.warn(
        `[backend] governance policy ${policyType} unreadable for org ${orgSlug}: ${result.message}`,
      );
    }
  } catch (error) {
    if (options.strict)
      throw error instanceof ConfigurationError ? error : governanceReadError();
    console.warn(
      `[backend] governance policy ${policyType} read threw for org ${orgSlug}:`,
      error,
    );
  }

  policyCache.set(cacheKey, { at: Date.now(), value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated by POLICY_SCHEMAS[policyType].parse above
  return value as ReturnType<(typeof POLICY_SCHEMAS)[T]['parse']> | null;
}

/**
 * Read one governance policy by org ID (slug resolved + cached), for callers
 * holding only the id — e.g. the login-throttle policy resolution.
 */
export async function readGovernancePolicyForOrg<T extends FilePolicyType>(
  sql: Sql | TransactionSql,
  organizationId: string,
  policyType: T,
  options: ReadGovernancePolicyOptions = {},
): Promise<ReturnType<(typeof POLICY_SCHEMAS)[T]['parse']> | null> {
  let slug: string | null;
  try {
    slug = options.strict
      ? await resolveOrgSlug(sql, organizationId, { fresh: true })
      : await resolveOrgSlug(sql, organizationId);
  } catch (error) {
    if (options.strict) throw governanceReadError();
    throw error;
  }
  if (!slug) {
    if (options.strict) throw governanceReadError();
    return null;
  }
  return readGovernancePolicy(slug, policyType, options);
}
