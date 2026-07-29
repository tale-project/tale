'use node';

/**
 * Model-catalog resolution per provider connector — the one place that turns
 * a connector's declared `catalog.source` into normalized `ModelCatalogEntry`
 * lists:
 *
 *  - `static`          — the shipped `configs/platform/system/models/<name>.yml`
 *                        (mtime-cached by the system-config loader).
 *  - `openrouter-api`  — OpenRouter's public `/api/v1/models`.
 *  - `models-endpoint` — the connector's own OpenAI-compatible `/models`
 *                        listing (e.g. the Vercel AI Gateway).
 *
 * Live sources are fetched at most once a day per connector (in-process
 * cache); an explicit user-triggered refresh bypasses the window. There is no
 * background merge into org config — the catalog is a read-through cache, and
 * the fetched facts never overwrite anything an operator wrote.
 *
 * On a fetch failure the last good result keeps serving (with a logged
 * warning): a flaky egress path or an upstream outage must degrade model
 * listings, not blank them. A cold failure (nothing cached yet) surfaces to
 * the caller.
 *
 * Both live endpoints are public, unauthenticated catalog listings; no
 * credential material is ever attached to these requests.
 */

import { normalizeCatalogPayload } from '../../../lib/shared/providers/catalog_normalize';
import type {
  ModelCatalogEntry,
  ProviderConnector,
} from '../../../lib/shared/schemas/providers';
import { safeFetch, SafeFetchError } from '../http/safe_fetch';
import {
  loadStaticCatalogs,
  type LoadSystemConfigOptions,
} from './load_system_config';

const OPENROUTER_CATALOG_URL = 'https://openrouter.ai/api/v1/models';

/** Live catalogs refresh at most daily unless a user forces it. */
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20_000;
/** The full OpenRouter catalog (hundreds of models with rich metadata) is
 * well past safeFetch's 1 MB default and keeps growing. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;

interface CachedCatalog {
  fetchedAt: number;
  entries: ModelCatalogEntry[];
}

/** Keyed by connector name; lives for the Node action runtime's lifetime. */
const liveCatalogCache = new Map<string, CachedCatalog>();

/** Test seam: drop every cached live catalog. */
export function invalidateCatalogFetchCache(): void {
  liveCatalogCache.clear();
}

export interface CatalogFetchOptions extends LoadSystemConfigOptions {
  /** Bypass the daily window and refetch a live source now. */
  readonly forceRefresh?: boolean;
  /** Fetch attempts before giving up (tests dial this down to 1). */
  readonly maxAttempts?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch + parse one live listing with bounded linear-backoff retries.
 * Self-hosted instances can sit behind flaky egress, so a transient failure
 * gets a couple of retries with each attempt logged (including an explicit
 * offline hint) before the last error propagates.
 */
async function fetchListingPayload(
  url: string,
  provider: string,
  maxAttempts: number,
): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await safeFetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        timeoutMs: FETCH_TIMEOUT_MS,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`catalog fetch returned HTTP ${response.status}`);
      }
      return JSON.parse(response.body);
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const offlineHint =
        err instanceof SafeFetchError
          ? ' — the instance may be offline or the catalog host unreachable'
          : '';
      console.warn(
        `[catalog] ${provider} fetch attempt ${attempt}/${maxAttempts} failed: ${message}${offlineHint}`,
      );
      if (attempt < maxAttempts) await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Fetch → normalize → validate one live catalog; an empty usable set is a
 * failure (never cached — a blank catalog would silently empty the model
 * picker while the stale one is strictly better). */
async function fetchLiveCatalog(
  url: string,
  provider: string,
  maxAttempts: number,
): Promise<ModelCatalogEntry[]> {
  const payload = await fetchListingPayload(url, provider, maxAttempts);
  const { entries, droppedCount } = normalizeCatalogPayload(payload, provider);
  if (droppedCount > 0) {
    console.warn(
      `[catalog] ${provider}: dropped ${droppedCount} unusable listing entr${droppedCount === 1 ? 'y' : 'ies'} (missing id/context window or invalid shape)`,
    );
  }
  if (entries.length === 0) {
    throw new Error(
      `catalog for ${provider} yielded no usable models from ${url}`,
    );
  }
  return entries;
}

/** Fetched entries win by id; shipped defaults fill in whatever the live
 * listing doesn't carry (curated flagships pinned even when a listing drops
 * or renames them). */
function mergeWithDefaults(
  fetched: readonly ModelCatalogEntry[],
  defaults: readonly ModelCatalogEntry[] | undefined,
): readonly ModelCatalogEntry[] {
  if (!defaults || defaults.length === 0) return fetched;
  const fetchedIds = new Set(fetched.map((entry) => entry.id));
  return [...fetched, ...defaults.filter((entry) => !fetchedIds.has(entry.id))];
}

async function cachedLiveCatalog(
  connectorName: string,
  url: string,
  options: CatalogFetchOptions,
): Promise<readonly ModelCatalogEntry[]> {
  // A live source may ship a curated default set (`models/<name>.yml`) —
  // the offline floor and the guaranteed-flagships overlay.
  const defaults = loadStaticCatalogs(options).get(connectorName);
  const cached = liveCatalogCache.get(connectorName);
  const fresh =
    cached !== undefined && Date.now() - cached.fetchedAt < CATALOG_TTL_MS;
  if (fresh && !options.forceRefresh) {
    return mergeWithDefaults(cached.entries, defaults);
  }

  try {
    const entries = await fetchLiveCatalog(
      url,
      connectorName,
      options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    );
    liveCatalogCache.set(connectorName, { fetchedAt: Date.now(), entries });
    return mergeWithDefaults(entries, defaults);
  } catch (err) {
    if (cached !== undefined) {
      console.warn(
        `[catalog] ${connectorName}: refresh failed, serving the previous catalog (${cached.entries.length} models):`,
        err,
      );
      return mergeWithDefaults(cached.entries, defaults);
    }
    if (defaults !== undefined && defaults.length > 0) {
      console.warn(
        `[catalog] ${connectorName}: fetch failed with nothing cached; serving the shipped defaults (${defaults.length} models):`,
        err,
      );
      return defaults;
    }
    throw err;
  }
}

/** `<base>/models` with exactly one joining slash whatever the YAML wrote. */
function modelsEndpointUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/models`;
}

/**
 * The catalog for one connector, per its declared source. The exhaustive
 * switch is the case list: static file, OpenRouter API, own models endpoint,
 * or no shippable catalog at all.
 */
export async function getConnectorCatalog(
  connector: ProviderConnector,
  options: CatalogFetchOptions = {},
): Promise<readonly ModelCatalogEntry[]> {
  const source = connector.catalog.source;
  switch (source) {
    case 'static': {
      const catalog = loadStaticCatalogs(options).get(connector.name);
      if (!catalog) {
        console.warn(
          `[catalog] connector "${connector.name}" declares a static catalog but ships no models/${connector.name}.yml`,
        );
        return [];
      }
      return catalog;
    }
    case 'openrouter-api':
      return await cachedLiveCatalog(
        connector.name,
        OPENROUTER_CATALOG_URL,
        options,
      );
    case 'models-endpoint': {
      // The schema refuses a models-endpoint catalog without a fixed
      // baseUrl; this guard keeps the invariant visible at the use site.
      if (connector.baseUrl === undefined) {
        throw new Error(
          `[catalog] connector "${connector.name}" declares a models-endpoint catalog but no baseUrl`,
        );
      }
      return await cachedLiveCatalog(
        connector.name,
        modelsEndpointUrl(connector.baseUrl),
        options,
      );
    }
    case 'none':
      // Model availability comes entirely from each credential's own
      // allowlist (Azure deployment names, subscription marketplaces).
      return [];
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}
