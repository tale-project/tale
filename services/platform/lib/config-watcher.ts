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
 * Parse a relative path within the config directory into a structured event,
 * under the uniform org-first layout `${TALE_CONFIG_DIR}/<orgSlug>/<domain>/...`.
 *
 * Examples (with `default` as one possible orgSlug):
 *   default/agents/my-agent.json           → { type: 'agents', orgSlug: 'default', slug: 'my-agent' }
 *   acme/agents/my-agent.json              → { type: 'agents', orgSlug: 'acme', slug: 'my-agent' }
 *   default/workflows/general/hello.json   → { type: 'workflows', orgSlug: 'default', slug: 'general/hello' }
 *   default/integrations/slack/config.json → { type: 'integrations', orgSlug: 'default', slug: 'slack' }
 *   default/branding/branding.json         → { type: 'branding', orgSlug: 'default' }
 *   default/skills/code-reviewer/SKILL.md  → { type: 'skills', orgSlug: 'default', slug: 'code-reviewer' }
 *
 * Returns null for paths that don't fit the `<org>/<domain>/<rest>` shape
 * (org slug must validate; domain must be recognized).
 */
function parseConfigChange(relativePath: string): ConfigChangeEvent | null {
  const parts = relativePath.split('/');
  if (parts.length < 2) return null;

  const orgSlug = parts[0];
  if (!ORG_SLUG_REGEX.test(orgSlug)) return null;

  const domain = parts[1];

  if (domain === 'branding') {
    // Branding is default-only on the read side, but still emit per-org so
    // future per-org branding (or operator inspection) sees the event.
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
    // <org>/agents/<name>.json
    const filename = rest[0];
    return { type, orgSlug, slug: filename.replace(/\.json$/, '') };
  }

  if (type === 'workflows') {
    // <org>/workflows/[folder/]name.json — slug is the path without extension
    const slug = rest.join('/').replace(/\.json$/, '');
    return { type, orgSlug, slug };
  }

  if (type === 'integrations') {
    // <org>/integrations/<slug>/config.json (or other bundle files)
    const slug = rest[0];
    return { type, orgSlug, slug };
  }

  if (type === 'providers') {
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

  watcher.on('all', (_eventName, filePath) => {
    const rel = relative(configDir, filePath);

    // Only react to JSON file changes; ignore secret sidecar files
    if (!rel.endsWith('.json')) return;
    if (rel.endsWith('.secrets.json')) return;

    const event = parseConfigChange(rel);
    if (!event) return;

    for (const cb of callbacks) {
      cb(event);
    }
  });

  return {
    onChange(callback) {
      callbacks.push(callback);
    },
    close() {
      return watcher.close();
    },
  };
}
