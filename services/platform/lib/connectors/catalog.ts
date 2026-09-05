/**
 * THE reader for the shipped connector catalog —
 * `configs/platform/system/connectors/<slug>/connector.yml`.
 *
 * Every surface that needs to know what a connector declares reads it here:
 * the engine registry turns actions into node types, the credential domain
 * checks which auth methods exist and which `Authorization` scheme a bearer
 * token uses, the OAuth routes read the authorize/token endpoints, and the
 * settings UI lists the catalog. One reader means a connector cannot appear
 * valid to one surface and invalid to another.
 *
 * The directory listing IS the registry: one directory per connector, each
 * holding a `connector.yml` whose `name` must equal its directory. A file that
 * fails to parse or validate throws with its path — a broken shipped connector
 * is a packaging defect, never something to skip silently.
 *
 * Root resolution is the shared system-catalog resolver
 * (`lib/shared/config/system-root.ts`): an explicit `root` (the `system/`
 * directory) wins; then `$TALE_CONFIG_SYSTEM_DIR`; otherwise the walk-up from
 * the working directory to the checkout's `configs/platform/system`, which
 * covers vitest, scripts, and the dev process. Parsed connectors are memoized per root and invalidated when any
 * `connector.yml`'s (mtime, size) changes, so editing a connector in dev takes
 * effect on the next call without re-reading the catalog on every lookup.
 *
 * Reading the catalog needs the filesystem, so consumers must be node-side
 * (`'use node'` actions, scripts, tests) — never a Convex V8 function.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  resolveSystemConfigRoot,
  SYSTEM_CONFIG_ROOT_REMEDY,
} from '../shared/config/system-root';
import { parseYamlOrThrow } from '../shared/config/yaml';
import { connectorSchema, type Connector } from '../shared/schemas/connectors';
import { zodErrorMessage } from '../shared/schemas/format-error';

/** One connector file may not exceed this — a connector is configuration. */
const MAX_CONNECTOR_BYTES = 1024 * 1024;

/** The scheme a bearer token is sent under when the connector names none. */
const DEFAULT_BEARER_SCHEME = 'Bearer';

export interface LoadConnectorCatalogOptions {
  /** Absolute path of the `system/` config directory (the one containing
   * `connectors/`). Defaults to the repo walk-up. */
  readonly root?: string;
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    // A missing entry is an ordinary listing miss, not an error.
    return false;
  }
}

export function resolveConnectorsDir(
  options: LoadConnectorCatalogOptions = {},
): string {
  const root = resolveSystemConfigRoot({ root: options.root });
  if (root === null) {
    throw new Error(
      `[connectors] no system config tree found: ${SYSTEM_CONFIG_ROOT_REMEDY}`,
    );
  }
  return path.join(root, 'connectors');
}

interface CachedCatalog {
  /** `<slug>:<mtimeMs>:<size>` per connector file, in listing order. */
  readonly stamps: string;
  readonly connectors: readonly Connector[];
}

const catalogCache = new Map<string, CachedCatalog>();

/** Connector directories of `dir`, sorted, with each file's change stamp. */
function stampConnectorDir(dir: string): { slugs: string[]; stamps: string } {
  const slugs = readdirSync(dir)
    .filter((entry) => isDirectory(path.join(dir, entry)))
    .sort();
  const stamps = slugs
    .map((slug) => {
      const file = path.join(dir, slug, 'connector.yml');
      try {
        const stat = statSync(file);
        return `${slug}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        // A directory without its connector.yml is a packaging defect; the
        // load below reports it with the full path.
        return `${slug}:missing`;
      }
    })
    .join('|');
  return { slugs, stamps };
}

/** Parse and validate one `connector.yml`, pinning its declared identity.
 * Module-private — `loadConnectorDefinitions` is the public entry. */
function loadConnectorFile(file: string, slug: string): Connector {
  const parsed = connectorSchema.safeParse(
    parseYamlOrThrow(readFileSync(file, 'utf8'), {
      maxBytes: MAX_CONNECTOR_BYTES,
    }),
  );
  if (!parsed.success) {
    throw new Error(
      `[connectors] connector ${file} is invalid: ${zodErrorMessage('it', parsed.error)}`,
    );
  }
  if (parsed.data.name !== slug) {
    throw new Error(
      `[connectors] connector ${file} declares name "${parsed.data.name}" but lives in "${slug}"`,
    );
  }
  return parsed.data;
}

/** The shipped connector catalog, sorted by slug. */
export function loadConnectorDefinitions(
  options: LoadConnectorCatalogOptions = {},
): readonly Connector[] {
  const dir = resolveConnectorsDir(options);
  const { slugs, stamps } = stampConnectorDir(dir);
  const cached = catalogCache.get(dir);
  if (cached && cached.stamps === stamps) return cached.connectors;

  const connectors = slugs.map((slug) =>
    loadConnectorFile(path.join(dir, slug, 'connector.yml'), slug),
  );
  catalogCache.set(dir, { stamps, connectors });
  return connectors;
}

/** One shipped connector by slug, or undefined when nothing ships it. */
export function findConnector(
  connectorSlug: string,
  options: LoadConnectorCatalogOptions = {},
): Connector | undefined {
  return loadConnectorDefinitions(options).find(
    (connector) => connector.name === connectorSlug,
  );
}

/**
 * The `Authorization` scheme this connector's bearer tokens are sent under.
 * Read from the connector's own `bearer` auth entry so a vendor that defines
 * its own scheme (Discord's `Bot`) is honoured; `Bearer` when the connector
 * offers no bearer method at all, which no caller acts on.
 */
export function connectorBearerScheme(connector: Connector): string {
  const entry = connector.auth.find((method) => method.method === 'bearer');
  return entry?.method === 'bearer' ? entry.scheme : DEFAULT_BEARER_SCHEME;
}
