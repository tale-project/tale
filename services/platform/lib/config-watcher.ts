import { relative } from 'node:path';

import chokidar from 'chokidar';

import {
  CONFIG_DOMAINS_BY_NAME,
  NESTED_SINGLE_FILE_WATCHERS,
} from './shared/config/registry';
import { ORG_SLUG_REGEX } from './shared/constants/org-slug';

interface ConfigChangeEvent {
  /**
   * A domain's `watcher.eventType` (`agents`/`providers`/…) or a nested
   * single-file eventType (`retention`). The frontend keys query-cache
   * invalidation on it.
   */
  type: string;
  orgSlug?: string;
  slug?: string;
}

const ATOMIC_WRITE_TMP_RE = /\.\d+\.[a-f0-9]{8}\.tmp$/;

/**
 * Tail-debounce window for SSE invalidations: events arriving within this
 * window for the same (type, orgSlug, slug) key collapse to a single
 * delivery. Bulk operations (org migrations, mass `git mv`) would
 * otherwise fan out one SSE frame per file × per connected client.
 */
const EMIT_DEBOUNCE_MS = 100;

/**
 * Parse a relative path within the config directory into a structured event,
 * under the uniform org-first layout `${TALE_CONFIG_DIR}/<orgSlug>/<domain>/...`.
 *
 * Entirely registry-driven (`lib/shared/config/registry.ts`): a domain emits an
 * SSE event iff it declares a `watcher` spec — the domains read via Convex
 * ACTIONS (agents/providers/integrations/workflows/skills/branding), which
 * aren't reactive and so need an explicit invalidation. `v8-sync` domains
 * (governance) are read through reactive Convex queries on `configCache` (the
 * write-path sync updates subscribers automatically) and need no SSE event;
 * `prompts` is DB-authoritative seeded data. Nested single-file configs read via
 * a V8 action (retention at `<org>/governance/retention.json`) emit via
 * `NESTED_SINGLE_FILE_WATCHERS`.
 *
 * Examples:
 *   default/agents/my-agent.json           → { type:'agents', orgSlug:'default', slug:'my-agent' }
 *   default/workflows/general/hello.json   → { type:'workflows', orgSlug:'default', slug:'general/hello' }
 *   default/integrations/slack/config.json → { type:'integrations', orgSlug:'default', slug:'slack' }
 *   default/branding/branding.json         → { type:'branding', orgSlug:'default' }
 *   default/skills/code-reviewer/SKILL.md  → { type:'skills', orgSlug:'default', slug:'code-reviewer' }
 *   default/governance/retention.json      → { type:'retention', orgSlug:'default', slug:'retention' }
 *
 * Returns null for paths that don't fit `<org>/<domain>/<rest>`, unrecognized
 * domains, per-domain filter misses, and secret sidecars.
 */
function parseConfigChange(relativePath: string): ConfigChangeEvent | null {
  // Secret sidecars are written by operators only; never broadcast.
  if (relativePath.endsWith('.secrets.json')) return null;

  const parts = relativePath.split('/');
  // Need org + domain + at least one path segment below the domain dir.
  if (parts.length < 3) return null;

  const orgSlug = parts[0];
  if (!ORG_SLUG_REGEX.test(orgSlug)) return null;

  const domainName = parts[1];
  const rest = parts.slice(2);
  const relWithinDomain = rest.join('/');

  // Nested single-file configs (e.g. governance/retention.json): read via a V8
  // action, so not reactive — they get their own SSE event.
  for (const nested of NESTED_SINGLE_FILE_WATCHERS) {
    if (
      domainName === nested.domain &&
      rest.length === 1 &&
      rest[0] === nested.file
    ) {
      return { type: nested.eventType, orgSlug, slug: nested.eventType };
    }
  }

  const spec = CONFIG_DOMAINS_BY_NAME.get(domainName)?.watcher;
  if (!spec) return null;
  if (!spec.emitsFor(relWithinDomain)) return null;

  return { type: spec.eventType, orgSlug, slug: spec.slugFromRest(rest) };
}

interface ConfigWatcher {
  onChange: (callback: (event: ConfigChangeEvent) => void) => void;
  close: () => Promise<void>;
}

export function createConfigWatcher(configDir: string): ConfigWatcher {
  const callbacks: Array<(event: ConfigChangeEvent) => void> = [];

  const watcher = chokidar.watch(configDir, {
    ignoreInitial: true,
    ignored: [
      /(^|[/\\])\.history/, // history directories
      ATOMIC_WRITE_TMP_RE, // atomicWrite temp files
    ],
  });

  // Per-key tail debounce: collapses bursts of events for the same
  // (type, orgSlug, slug) so a bulk operation (e.g. mass migration)
  // doesn't fan out one SSE frame per file per connected client.
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const emitDebounced = (event: ConfigChangeEvent) => {
    const key = `${event.type}:${event.orgSlug ?? ''}:${event.slug ?? ''}`;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        for (const cb of callbacks) {
          cb(event);
        }
      }, EMIT_DEBOUNCE_MS),
    );
  };

  watcher.on('all', (_eventName, filePath) => {
    const rel = relative(configDir, filePath);
    const event = parseConfigChange(rel);
    if (!event) return;
    emitDebounced(event);
  });

  return {
    onChange(callback) {
      callbacks.push(callback);
    },
    async close() {
      // Drop any pending debounced events so we don't emit after close.
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      await watcher.close();
    },
  };
}
