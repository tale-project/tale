'use node';

/**
 * Org-defined custom providers — the `providers` config domain.
 *
 * Beyond the shipped system providers, an organization can point the
 * platform at its own OpenAI-compatible (or Anthropic-format) endpoint —
 * a vLLM/Ollama box, an internal gateway — by dropping one YAML per
 * provider into its config tree:
 *
 *   {TALE_CONFIG_DIR}/<orgSlug>/providers/<name>.yml
 *
 * Each file validates against the SAME `providerDefinitionSchema` the shipped
 * providers use; the provider name must equal the filename stem, and a
 * custom provider may never shadow a shipped provider's name. A custom
 * provider normally declares `catalog: { source: models-endpoint }` (its
 * own `/models` listing); `static` has no org-side models file, so it
 * resolves to an empty catalog with a logged warning.
 *
 * The same directory may still hold retired-format `<name>.json` +
 * `<name>.secrets.json` files from before the credentials rewrite (the
 * 0.4.0/02 migration reads them; a later cleanup removes them). This loader
 * reads ONLY `*.yml` and ignores `*.secrets.yml` sidecars, so the two
 * generations never collide.
 *
 * A file that fails to parse or validate is skipped LOUDLY (console.error
 * naming the file and reason): one corrupt provider must not take down
 * provider resolution for the org, and a silent skip would break the
 * provider invisibly.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  providerDefinitionSchema,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';

import { parseYaml } from '../../../../lib/shared/config/yaml';
import { zodErrorMessage } from '../../../../lib/shared/schemas/format-error';
import { errnoCode, getConfigRoot, sha256, validateOrgSlug } from '../file_io';
import { orgSlugFromId } from '../helpers/org_slug';
import {
  loadProviderDefinitions,
  type LoadSystemConfigOptions,
} from './load_system_config';

/** Absolute on-disk dir of an org's `providers` config domain. */
export function resolveProvidersDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('providers'), orgSlug, 'providers');
}

/**
 * One custom provider as its file holds it: the definition, and the hash of
 * the exact bytes it was parsed from — the native version an edit of those
 * facts names as its precondition.
 */
export interface OrgCustomProviderSnapshot {
  provider: ProviderDefinition;
  hash: string;
}

/**
 * The org's custom providers, sorted by name. Missing dir → empty (the
 * domain is created on demand); invalid files are skipped with an error log.
 */
export function loadOrgCustomProviders(
  orgSlug: string,
  options: LoadSystemConfigOptions = {},
): ProviderDefinition[] {
  return loadOrgCustomProviderSnapshots(orgSlug, options).map(
    (snapshot) => snapshot.provider,
  );
}

/**
 * One custom provider file as last parsed, keyed by its path and valid while
 * the file's stamp (mtime + size) is unchanged. Provider resolution runs on
 * every chat turn, composer listing and cost estimate; reading, YAML-parsing
 * and validating every file of the org on each of those calls was a
 * measurable share of an API process's CPU under load, all of it
 * synchronous on the event loop. The directory is still listed and each
 * file still stat-ed on every call, so an edit is seen on the very next
 * call exactly as before — only an unchanged file skips the parse.
 */
interface ParsedProviderFile {
  mtimeMs: number;
  size: number;
  outcome:
    | { ok: true; provider: ProviderDefinition; hash: string }
    | { ok: false; reason: string };
}

const parsedProviderFiles = new Map<string, ParsedProviderFile>();

function parseProviderFile(file: string): ParsedProviderFile['outcome'] {
  let stat;
  try {
    stat = statSync(file);
  } catch (err) {
    parsedProviderFiles.delete(file);
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  const cached = parsedProviderFiles.get(file);
  if (
    cached !== undefined &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return cached.outcome;
  }
  let outcome: ParsedProviderFile['outcome'];
  try {
    const content = readFileSync(file, 'utf8');
    const parsed = parseYaml(content);
    if (!parsed.ok) throw new Error(parsed.error);
    const validated = providerDefinitionSchema.safeParse(parsed.data);
    if (!validated.success) {
      throw new Error(zodErrorMessage('Invalid provider', validated.error));
    }
    outcome = { ok: true, provider: validated.data, hash: sha256(content) };
  } catch (err) {
    outcome = {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  parsedProviderFiles.set(file, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    outcome,
  });
  return outcome;
}

/** {@link loadOrgCustomProviders}, each definition with the hash of its file. */
export function loadOrgCustomProviderSnapshots(
  orgSlug: string,
  options: LoadSystemConfigOptions = {},
  shipped: readonly ProviderDefinition[] = loadProviderDefinitions(options),
): OrgCustomProviderSnapshot[] {
  const dir = resolveProvidersDir(orgSlug);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }

  const shippedNames = new Set(shipped.map((provider) => provider.name));
  const providers: OrgCustomProviderSnapshot[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yml') || entry.endsWith('.secrets.yml')) continue;
    const file = path.join(dir, entry);
    const stem = entry.slice(0, -'.yml'.length);
    const outcome = parseProviderFile(file);
    if (!outcome.ok) {
      console.error(
        `[org-providers] skipping unreadable provider ${file}:`,
        outcome.reason,
      );
      continue;
    }
    const { provider } = outcome;
    if (provider.name !== stem) {
      console.error(
        `[org-providers] skipping ${file}: provider name "${provider.name}" must match the file name "${stem}"`,
      );
      continue;
    }
    if (shippedNames.has(provider.name)) {
      console.error(
        `[org-providers] skipping ${file}: "${provider.name}" shadows a shipped provider — rename the custom provider`,
      );
      continue;
    }
    providers.push({ provider, hash: outcome.hash });
  }
  return providers;
}

/**
 * Every provider available to an org: the shipped set plus its custom ones
 * (shadowing is refused at load, so names are unique across the union).
 */
export function resolveProvidersForOrg(
  orgSlug: string,
  options: LoadSystemConfigOptions = {},
): ProviderDefinition[] {
  // The shipped set is loaded once and handed to the custom loader, which
  // needs it only to refuse a name that would shadow a shipped provider.
  const shipped = loadProviderDefinitions(options);
  return [
    ...shipped,
    ...loadOrgCustomProviderSnapshots(orgSlug, options, shipped).map(
      (snapshot) => snapshot.provider,
    ),
  ];
}

/** Loose ctx shape matching `orgSlugFromId`'s requirement. */
type CtxWithRunQuery = Parameters<typeof orgSlugFromId>[0];

/**
 * `resolveProvidersForOrg` keyed by the Better Auth organization id —
 * the id every Convex action ctx carries.
 */
export async function resolveProvidersForOrgId(
  ctx: CtxWithRunQuery,
  organizationId: string,
  options: LoadSystemConfigOptions = {},
): Promise<ProviderDefinition[]> {
  const orgSlug = await orgSlugFromId(ctx, organizationId);
  return resolveProvidersForOrg(orgSlug, options);
}
