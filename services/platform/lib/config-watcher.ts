import { relative } from 'node:path';

import chokidar from 'chokidar';

interface ConfigChangeEvent {
  type:
    | 'agents'
    | 'workflows'
    | 'integrations'
    | 'providers'
    | 'branding'
    | 'skills';
  orgSlug?: string;
  slug?: string;
}

const ATOMIC_WRITE_TMP_RE = /\.\d+\.[a-f0-9]{8}\.tmp$/;
// Must match validateOrgSlug at services/platform/convex/lib/file_io.ts.
const ORG_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

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
 * Per-domain file filter (a write must match the domain's content shape;
 * otherwise the event is dropped):
 *   - agents / workflows / providers / branding / integrations: `.json` only
 *   - skills: any file (`SKILL.md`, `scripts/*.py`, assets) — skill query
 *     keys are invalidated at slug granularity, so any write under the slug
 *     dir must emit.
 *
 * Examples (with `default` as one possible orgSlug):
 *   default/agents/my-agent.json           → { type: 'agents', orgSlug: 'default', slug: 'my-agent' }
 *   acme/agents/my-agent.json              → { type: 'agents', orgSlug: 'acme', slug: 'my-agent' }
 *   default/workflows/general/hello.json   → { type: 'workflows', orgSlug: 'default', slug: 'general/hello' }
 *   default/integrations/slack/config.json → { type: 'integrations', orgSlug: 'default', slug: 'slack' }
 *   default/branding/branding.json         → { type: 'branding', orgSlug: 'default' }
 *   default/skills/code-reviewer/SKILL.md  → { type: 'skills', orgSlug: 'default', slug: 'code-reviewer' }
 *   default/skills/code-reviewer/scripts/x.py → { type: 'skills', orgSlug: 'default', slug: 'code-reviewer' }
 *
 * Returns null for paths that don't fit the `<org>/<domain>/<rest>` shape
 * (org slug must validate; domain must be recognized; per-domain filter must
 * pass; secret sidecars dropped).
 */
function parseConfigChange(relativePath: string): ConfigChangeEvent | null {
  // Secret sidecars are written by operators only; never broadcast.
  if (relativePath.endsWith('.secrets.json')) return null;

  const parts = relativePath.split('/');
  if (parts.length < 2) return null;

  const orgSlug = parts[0];
  if (!ORG_SLUG_REGEX.test(orgSlug)) return null;

  const domain = parts[1];

  if (domain === 'branding') {
    // Branding is default-only on the read side, but still emit per-org so
    // future per-org branding (or operator inspection) sees the event.
    if (!relativePath.endsWith('.json')) return null;
    return { type: 'branding', orgSlug };
  }

  const typeMap: Record<string, ConfigChangeEvent['type']> = {
    agents: 'agents',
    workflows: 'workflows',
    integrations: 'integrations',
    providers: 'providers',
    skills: 'skills',
  };

  const type = typeMap[domain];
  if (!type) return null;

  const rest = parts.slice(2);
  if (rest.length === 0) return null;

  if (type === 'agents') {
    if (!relativePath.endsWith('.json')) return null;
    // <org>/agents/<name>.json
    const filename = rest[0];
    return { type, orgSlug, slug: filename.replace(/\.json$/, '') };
  }

  if (type === 'workflows') {
    if (!relativePath.endsWith('.json')) return null;
    // <org>/workflows/[folder/]name.json — slug is the path without extension
    const slug = rest.join('/').replace(/\.json$/, '');
    return { type, orgSlug, slug };
  }

  if (type === 'integrations') {
    if (!relativePath.endsWith('.json')) return null;
    // <org>/integrations/<slug>/config.json (or other bundle files)
    const slug = rest[0];
    return { type, orgSlug, slug };
  }

  if (type === 'providers') {
    if (!relativePath.endsWith('.json')) return null;
    // <org>/providers/<name>.json
    const filename = rest[0];
    return { type, orgSlug, slug: filename.replace(/\.json$/, '') };
  }

  if (type === 'skills') {
    // <org>/skills/<slug>/SKILL.md (or any asset under the slug dir).
    // Emit at slug granularity so a write to scripts/x.py invalidates the
    // same query keys as a SKILL.md write.
    const slug = rest[0];
    return { type, orgSlug, slug };
  }

  return null;
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
