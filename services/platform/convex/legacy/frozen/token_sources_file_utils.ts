'use node';

/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Trimmed copy of `file_utils.ts` from the retired `convex/token_sources/`
 * domain. Trimmed to the surface
 * `v0_4_0/02_provider_credentials_from_files/migration.ts` imports: the
 * path resolvers, the JSON/secrets parsers, and a slug enumeration helper.
 * NOT frozen: `loadTokenSource` / `loadTokenSourceSecret` /
 * `tokenSourceSecretExists` / the `TokenSourceReadResult` envelope — the
 * migration reads files through the bound migration helpers and the live
 * SOPS reader, not the retired read wrappers.
 *
 * Dependency substitutions from the original:
 *  - `TokenSource` / `tokenSourceSchema` / `tokenSourceSecretsSchema`
 *    (`lib/shared/schemas/token_sources.ts`, retired) → also-frozen at
 *    `legacy/frozen/schemas_token_sources.ts`.
 *  - `zodErrorMessage` (`lib/shared/schemas/format-error.ts`) is STILL LIVE —
 *    imported directly, unchanged.
 *  - `getConfigRoot` / `safeJoinWithinDir` / `validateOrgSlug` / `readdirSafe`
 *    (`convex/lib/file_io.ts`) are STILL LIVE — imported directly, unchanged.
 *  - `validateTokenSourceSlug` (`convex/token_sources/validators.ts`,
 *    retired — a single regex test) is inlined below verbatim.
 *  - `listTokenSourceSlugs` distils the enumeration loop of the retired
 *    `file_actions.ts#listTokenSources` (readdir + `.json`-but-not-
 *    `.secrets.json` filter + slug validation) into the one helper the
 *    file→row migration needs.
 */

import path from 'node:path';

import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import {
  getConfigRoot,
  readdirSafe,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../../lib/file_io';
import {
  TOKEN_SOURCE_SLUG_REGEX,
  tokenSourceSchema,
  tokenSourceSecretsSchema,
  type TokenSource,
  type TokenSourceSecrets,
} from './schemas_token_sources';

// -----------------------------------------------------------------------------
// retired convex/token_sources/validators.ts (only
// `validateTokenSourceSlug` is needed here, by the path resolvers).
// -----------------------------------------------------------------------------
function validateTokenSourceSlug(slug: string): boolean {
  return TOKEN_SOURCE_SLUG_REGEX.test(slug);
}

export function resolveTokenSourcesDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug))
    throw new Error(`Invalid org slug: ${orgSlug}`);
  return path.join(getConfigRoot('token-sources'), orgSlug, 'token-sources');
}

export function resolveTokenSourceFilePath(
  orgSlug: string,
  slug: string,
): string {
  if (!validateTokenSourceSlug(slug)) {
    throw new Error(`Invalid token source slug: ${slug}`);
  }
  return safeJoinWithinDir(resolveTokenSourcesDir(orgSlug), `${slug}.json`);
}

export function resolveTokenSourceSecretsPath(
  orgSlug: string,
  slug: string,
): string {
  if (!validateTokenSourceSlug(slug)) {
    throw new Error(`Invalid token source slug: ${slug}`);
  }
  return safeJoinWithinDir(
    resolveTokenSourcesDir(orgSlug),
    `${slug}.secrets.json`,
  );
}

export function parseTokenSourceJson(content: string): TokenSource {
  const parsed: unknown = JSON.parse(content);
  const result = tokenSourceSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(zodErrorMessage('Invalid token source JSON', result.error));
  }
  return result.data;
}

export function parseTokenSourceSecrets(
  data: Record<string, unknown>,
): TokenSourceSecrets {
  const result = tokenSourceSecretsSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid token source secrets', result.error),
    );
  }
  return result.data;
}

/**
 * The valid token-source slugs present in an org's retired `token-sources/`
 * dir — `<slug>.json` entries minus the `.secrets.json` sidecars, sorted for
 * deterministic iteration. Invalid slugs are skipped with a warning exactly
 * as the retired lister skipped them; a missing dir yields [].
 */
export async function listTokenSourceSlugs(orgSlug: string): Promise<string[]> {
  const slugs: string[] = [];
  for (const entry of (
    await readdirSafe(resolveTokenSourcesDir(orgSlug))
  ).sort()) {
    if (!entry.endsWith('.json') || entry.endsWith('.secrets.json')) continue;
    const slug = path.basename(entry, '.json');
    if (!validateTokenSourceSlug(slug)) {
      console.warn(
        `[legacy-token-sources] "${entry}": invalid token source slug, skipping.`,
      );
      continue;
    }
    slugs.push(slug);
  }
  return slugs;
}
