'use node';

/**
 * Org-defined custom provider connectors — the `providers` config domain.
 *
 * Beyond the shipped system connectors, an organization can point the
 * platform at its own OpenAI-compatible (or Anthropic-format) endpoint —
 * a vLLM/Ollama box, an internal gateway — by dropping one YAML per
 * connector into its config tree:
 *
 *   {TALE_CONFIG_DIR}/<orgSlug>/providers/<name>.yml
 *
 * Each file validates against the SAME `providerConnectorSchema` the shipped
 * connectors use; the connector name must equal the filename stem, and a
 * custom connector may never shadow a shipped connector's name. A custom
 * connector normally declares `catalog: { source: models-endpoint }` (its
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
 * naming the file and reason): one corrupt connector must not take down
 * provider resolution for the org, and a silent skip would break the
 * connector invisibly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseYaml } from '../../../lib/shared/config/yaml';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import {
  providerConnectorSchema,
  type ProviderConnector,
} from '../../../lib/shared/schemas/providers';
import { errnoCode, getConfigRoot, validateOrgSlug } from '../file_io';
import { orgSlugFromId } from '../helpers/org_slug';
import {
  loadProviderConnectors,
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
 * The org's custom connectors, sorted by name. Missing dir → empty (the
 * domain is created on demand); invalid files are skipped with an error log.
 */
export function loadOrgCustomConnectors(
  orgSlug: string,
  options: LoadSystemConfigOptions = {},
): ProviderConnector[] {
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
    loadProviderConnectors(options).map((connector) => connector.name),
  );
  const connectors: ProviderConnector[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yml') || entry.endsWith('.secrets.yml')) continue;
    const file = path.join(dir, entry);
    const stem = entry.slice(0, -'.yml'.length);
    let connector: ProviderConnector;
    try {
      const parsed = parseYaml(readFileSync(file, 'utf8'));
      if (!parsed.ok) throw new Error(parsed.error);
      const outcome = providerConnectorSchema.safeParse(parsed.data);
      if (!outcome.success) {
        throw new Error(
          zodErrorMessage('Invalid provider connector', outcome.error),
        );
      }
      connector = outcome.data;
    } catch (err) {
      console.error(
        `[org-connectors] skipping unreadable connector ${file}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
    if (connector.name !== stem) {
      console.error(
        `[org-connectors] skipping ${file}: connector name "${connector.name}" must match the file name "${stem}"`,
      );
      continue;
    }
    if (shippedNames.has(connector.name)) {
      console.error(
        `[org-connectors] skipping ${file}: "${connector.name}" shadows a shipped connector — rename the custom connector`,
      );
      continue;
    }
    connectors.push(connector);
  }
  return connectors;
}

/**
 * Every connector available to an org: the shipped set plus its custom ones
 * (shadowing is refused at load, so names are unique across the union).
 */
export function resolveConnectorsForOrg(
  orgSlug: string,
  options: LoadSystemConfigOptions = {},
): ProviderConnector[] {
  return [
    ...loadProviderConnectors(options),
    ...loadOrgCustomConnectors(orgSlug, options),
  ];
}

/** Loose ctx shape matching `orgSlugFromId`'s requirement. */
type CtxWithRunQuery = Parameters<typeof orgSlugFromId>[0];

/**
 * `resolveConnectorsForOrg` keyed by the Better Auth organization id —
 * the id every Convex action ctx carries.
 */
export async function resolveConnectorsForOrgId(
  ctx: CtxWithRunQuery,
  organizationId: string,
  options: LoadSystemConfigOptions = {},
): Promise<ProviderConnector[]> {
  const orgSlug = await orgSlugFromId(ctx, organizationId);
  return resolveConnectorsForOrg(orgSlug, options);
}
