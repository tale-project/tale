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

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseYaml } from '../../../../lib/shared/config/yaml';
import { zodErrorMessage } from '../../../../lib/shared/schemas/format-error';
import {
  providerDefinitionSchema,
  type ProviderDefinition,
} from '../../../../lib/shared/schemas/providers';
import { errnoCode, getConfigRoot, validateOrgSlug } from '../file_io';
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
 * The org's custom providers, sorted by name. Missing dir → empty (the
 * domain is created on demand); invalid files are skipped with an error log.
 */
export function loadOrgCustomProviders(
  orgSlug: string,
  options: LoadSystemConfigOptions = {},
): ProviderDefinition[] {
  const dir = resolveProvidersDir(orgSlug);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }

  const shippedNames = new Set(
    loadProviderDefinitions(options).map((provider) => provider.name),
  );
  const providers: ProviderDefinition[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yml') || entry.endsWith('.secrets.yml')) continue;
    const file = path.join(dir, entry);
    const stem = entry.slice(0, -'.yml'.length);
    let provider: ProviderDefinition;
    try {
      const parsed = parseYaml(readFileSync(file, 'utf8'));
      if (!parsed.ok) throw new Error(parsed.error);
      const outcome = providerDefinitionSchema.safeParse(parsed.data);
      if (!outcome.success) {
        throw new Error(zodErrorMessage('Invalid provider', outcome.error));
      }
      provider = outcome.data;
    } catch (err) {
      console.error(
        `[org-providers] skipping unreadable provider ${file}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
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
    providers.push(provider);
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
  return [
    ...loadProviderDefinitions(options),
    ...loadOrgCustomProviders(orgSlug, options),
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
