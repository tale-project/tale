'use node';

/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Trimmed copy of `file_utils.ts` from the retired `convex/providers/`
 * domain. Trimmed to
 * `parseProviderJson` / `serializeProviderJson` / `resolveProviderFilePath` /
 * `parseProviderSecrets` / `resolveProviderSecretsPath` /
 * `listProviderNames` — the surface
 * `v0_2_98/01_claude_code_fable_default/migration.ts`,
 * `v0_4_0/02_provider_credentials_from_files/migration.ts`, and
 * `testing/world/seed_fs.testkit.ts` import. NOT frozen:
 * `providerNameFromFileName` / the `ProviderReadResult` type — no migration
 * reads a provider through the old result envelope.
 *
 * Dependency substitutions from the original:
 *  - `ProviderJson` / `providerJsonSchema` / `ProviderSecrets` /
 *    `providerSecretsSchema` (`lib/shared/schemas/providers.ts`, retired) →
 *    also-frozen at `legacy/frozen/schemas_providers.ts`.
 *  - `zodErrorMessage` (`lib/shared/schemas/format-error.ts`) is STILL LIVE —
 *    imported directly, unchanged.
 *  - `getConfigRoot` / `safeJoinWithinDir` / `serializeJson` / `validateOrgSlug`
 *    (`convex/lib/file_io.ts`) are STILL LIVE — imported directly, unchanged.
 *  - `validateProviderName` (`convex/providers/validators.ts`, retired — a
 *    single regex + function) is inlined below verbatim.
 *  - `listProviderNames` distils the enumeration loop of the retired
 *    `file_actions.ts#loadAllProviders` (readdir + `.json`-but-not-
 *    `.secrets.json` filter + name validation) into the one helper the
 *    file→row migration needs.
 */

import path from 'node:path';

import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import {
  getConfigRoot,
  readdirSafe,
  safeJoinWithinDir,
  serializeJson,
  validateOrgSlug,
} from '../../lib/file_io';
import {
  type ProviderJson,
  type ProviderSecrets,
  providerJsonSchema,
  providerSecretsSchema,
} from './schemas_providers';

// -----------------------------------------------------------------------------
// retired convex/providers/validators.ts (only
// `validateProviderName` is needed here, by `resolveProviderFilePath`).
// -----------------------------------------------------------------------------
const PROVIDER_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,99}$/;
function validateProviderName(name: string): boolean {
  return PROVIDER_NAME_REGEX.test(name);
}

export function serializeProviderJson(config: ProviderJson): string {
  return serializeJson(config);
}

/**
 * Migrate legacy per-model `default: boolean` to provider-level `defaults` map.
 * Mutates the raw JSON object in place before Zod validation.
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- operating on raw JSON before Zod validation
function migrateModelDefaults(data: Record<string, unknown>): void {
  const models = data.models;
  if (!Array.isArray(models)) return;
  if (data.defaults !== undefined) return;

  const defaults: Record<string, string> = {};
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON models before validation
  for (const model of models as Record<string, unknown>[]) {
    if (model.default === true) {
      const tags = model.tags;
      const id = model.id;
      if (Array.isArray(tags) && typeof id === 'string') {
        for (const tag of tags) {
          if (typeof tag === 'string' && !(tag in defaults)) {
            defaults[tag] = id;
          }
        }
      }
    }
    delete model.default;
  }

  if (Object.keys(defaults).length > 0) {
    data.defaults = defaults;
  }
}

export function parseProviderJson(content: string): ProviderJson {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON before Zod validation
  const parsed = JSON.parse(content) as Record<string, unknown>;
  migrateModelDefaults(parsed);
  const result = providerJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(zodErrorMessage('Invalid provider JSON', result.error));
  }
  return result.data;
}

export function resolveProvidersDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug))
    throw new Error(`Invalid org slug: ${orgSlug}`);
  return path.join(getConfigRoot('providers'), orgSlug, 'providers');
}

export function resolveProviderFilePath(
  orgSlug: string,
  providerName: string,
): string {
  if (!validateProviderName(providerName))
    throw new Error(`Invalid provider name: ${providerName}`);
  return safeJoinWithinDir(
    resolveProvidersDir(orgSlug),
    `${providerName}.json`,
  );
}

export function resolveProviderSecretsPath(
  orgSlug: string,
  providerName: string,
): string {
  if (!validateProviderName(providerName))
    throw new Error(`Invalid provider name: ${providerName}`);
  return safeJoinWithinDir(
    resolveProvidersDir(orgSlug),
    `${providerName}.secrets.json`,
  );
}

export function parseProviderSecrets(
  data: Record<string, unknown>,
): ProviderSecrets {
  const result = providerSecretsSchema.safeParse(data);
  if (!result.success) {
    throw new Error(zodErrorMessage('Invalid provider secrets', result.error));
  }
  return result.data;
}

/**
 * The valid provider names present in an org's retired `providers/` dir —
 * `<name>.json` entries minus the `.secrets.json` sidecars, sorted for
 * deterministic iteration. Invalid names are skipped with a warning exactly
 * as the retired loader skipped them; a missing dir yields [].
 */
export async function listProviderNames(orgSlug: string): Promise<string[]> {
  const names: string[] = [];
  for (const entry of (
    await readdirSafe(resolveProvidersDir(orgSlug))
  ).sort()) {
    if (!entry.endsWith('.json') || entry.endsWith('.secrets.json')) continue;
    const name = path.basename(entry, '.json');
    if (!validateProviderName(name)) {
      console.warn(
        `[legacy-providers] "${entry}": invalid provider name, skipping.`,
      );
      continue;
    }
    names.push(name);
  }
  return names;
}
