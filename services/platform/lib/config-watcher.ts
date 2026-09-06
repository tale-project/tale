/**
 * Live config-file events for open browser tabs.
 *
 * Per-org configuration is a file tree, `$TALE_CONFIG_DIR/<orgSlug>/<domain>/…`
 * (see lib/shared/config/registry.ts), edited by the app, the CLI, a `git
 * pull` on the volume, or an operator with a text editor. This watcher turns
 * each on-disk change into the event the frontend cache keys on —
 * `{ type: <domain dir>, orgSlug, slug }` maps onto the TanStack Query key
 * `['config', type, organizationId, …]` (app/hooks/use-file-events.ts) — so
 * an edit shows up without a reload. server.ts fans the events out over the
 * authenticated `/events/file` SSE door, per-org (shouldDeliverSseEvent);
 * vite-plugins/watch-examples.ts serves the same door in `vite dev`. Every
 * event carries an `orgSlug`: the fan-out is default-deny without one.
 *
 * The domain is the dir name, not a registry lookup: the registry lists the
 * catalog-seeded domains, while live surfaces such as `branding/` are
 * unregistered yet still cache under `['config', 'branding', orgId]`. Dot
 * entries never emit — `.history/` snapshots, `*.secrets` never leave the
 * server as a name either way, and the `.<name>.<ts>.<rand>.tmp` files of
 * `atomicWrite` are how every config write lands, so the rename then reads
 * as one change of the real file.
 */

import path from 'node:path';

import { watch } from 'chokidar';

import { isValidOrgSlug } from './shared/constants/org-slug';

export interface ConfigChangeEvent {
  /** The domain dir under the org — the `type` the frontend cache keys on. */
  type: string;
  orgSlug: string;
  /**
   * The item under the domain dir: a flat file's base name (`coder.yml` and
   * its `coder.secrets.json` sidecar both read `coder`) or a bundle's dir
   * (`skills/<slug>/…`). Absent when the domain dir itself came or went.
   */
  slug?: string;
}

export interface ConfigWatcher {
  onChange: (callback: (event: ConfigChangeEvent) => void) => void;
  /** Resolves once the initial scan is done and changes are being reported. */
  ready: Promise<void>;
  close: () => Promise<void>;
}

/** A domain dir is a lowercase kebab/snake name; anything else is not config. */
const DOMAIN_DIR_REGEX = /^[a-z][a-z0-9_-]*$/;

/**
 * Repeated events for one item inside this window collapse into one: an
 * atomic write is an `unlink` + `add` of the same path, a bundle replace is
 * one event per file, and the browser only needs one invalidation.
 */
const DEFAULT_COALESCE_MS = 50;

export interface ConfigWatcherOptions {
  /** Coalescing window per item, in ms (tests widen it to pin the collapse). */
  coalesceMs?: number;
}

/** Path segments below `configDir`, or null when `changedPath` is outside it. */
function segmentsWithin(
  configDir: string,
  changedPath: string,
): string[] | null {
  const rel = path.relative(configDir, changedPath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep);
}

/** Dot entries: `.history/`, atomic-write temp files, editor swap files. */
function hasDotSegment(segments: readonly string[]): boolean {
  return segments.some((segment) => segment.startsWith('.'));
}

/**
 * The event a changed path stands for, or null when the path is not an org
 * config item (outside the tree, a dot entry, a malformed org or domain
 * segment, or the org dir itself).
 */
export function parseConfigChange(
  configDir: string,
  changedPath: string,
): ConfigChangeEvent | null {
  const segments = segmentsWithin(configDir, changedPath);
  if (segments === null || hasDotSegment(segments)) return null;
  const [orgSlug, domain, item] = segments;
  if (orgSlug === undefined || domain === undefined) return null;
  if (!isValidOrgSlug(orgSlug) || !DOMAIN_DIR_REGEX.test(domain)) return null;
  if (item === undefined) return { type: domain, orgSlug };
  const slug = item.replace(/(\.secrets)?\.[^.]+$/, '');
  return slug === '' ? null : { type: domain, orgSlug, slug };
}

export function createConfigWatcher(
  configDir: string,
  options: ConfigWatcherOptions = {},
): ConfigWatcher {
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
  const callbacks = new Set<(event: ConfigChangeEvent) => void>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const emit = (event: ConfigChangeEvent): void => {
    const key = JSON.stringify(event);
    const scheduled = pending.get(key);
    if (scheduled !== undefined) clearTimeout(scheduled);
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        for (const callback of callbacks) {
          try {
            callback(event);
          } catch (err) {
            console.warn('[config-watcher] onChange callback failed', err);
          }
        }
      }, coalesceMs),
    );
  };

  const watcher = watch(configDir, {
    ignoreInitial: true,
    // Skip dot entries at the watch level too, so `.history/` trees cost no
    // inotify watches and temp files never reach the parser.
    ignored: (candidate) => {
      const segments = segmentsWithin(configDir, candidate);
      return segments !== null && hasDotSegment(segments);
    },
  });
  watcher.on('all', (_eventName, changedPath) => {
    const event = parseConfigChange(configDir, changedPath);
    if (event !== null) emit(event);
  });
  watcher.on('error', (err) => {
    console.warn(`[config-watcher] watch error under ${configDir}`, err);
  });
  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', () => resolve());
  });

  return {
    onChange(callback) {
      callbacks.add(callback);
    },
    ready,
    async close() {
      for (const scheduled of pending.values()) clearTimeout(scheduled);
      pending.clear();
      await watcher.close();
    },
  };
}
