import chokidar from 'chokidar';
import { relative } from 'node:path';

interface ConfigChangeEvent {
  type: 'agents' | 'workflows' | 'integrations' | 'providers' | 'branding';
  orgSlug?: string;
  slug?: string;
}

const ATOMIC_WRITE_TMP_RE = /\.\d+\.[a-f0-9]{8}\.tmp$/;

/**
 * Parse a relative path within the config directory into a structured event.
 *
 * Examples:
 *   agents/my-agent.json           → { type: 'agent', slug: 'my-agent' }
 *   agents/@acme/my-agent.json     → { type: 'agent', orgSlug: 'acme', slug: 'my-agent' }
 *   workflows/general/hello.json   → { type: 'workflow', slug: 'general/hello' }
 *   workflows/@acme/hello.json     → { type: 'workflow', orgSlug: 'acme', slug: 'hello' }
 *   integrations/slack/config.json → { type: 'integration', slug: 'slack' }
 *   integrations/@acme/slack/config.json → { type: 'integration', orgSlug: 'acme', slug: 'slack' }
 *   branding/branding.json         → { type: 'branding' }
 */
function parseConfigChange(relativePath: string): ConfigChangeEvent | null {
  const parts = relativePath.split('/');
  if (parts.length < 2) return null;

  const topDir = parts[0];

  if (topDir === 'branding') {
    return { type: 'branding' };
  }

  const typeMap: Record<string, ConfigChangeEvent['type']> = {
    agents: 'agents',
    workflows: 'workflows',
    integrations: 'integrations',
    providers: 'providers',
  };

  const type = typeMap[topDir];
  if (!type) return null;

  const rest = parts.slice(1);
  let orgSlug: string | undefined;

  // If the first segment after the top dir starts with @, it's an org slug
  if (rest[0]?.startsWith('@')) {
    orgSlug = rest[0].slice(1);
    rest.shift();
  }

  if (rest.length === 0) return null;

  if (type === 'agents') {
    // agents/[@org/]name.json
    const filename = rest[0];
    return { type, orgSlug, slug: filename.replace(/\.json$/, '') };
  }

  if (type === 'workflows') {
    // workflows/[@org/][folder/]name.json — slug is the path without extension
    const slug = rest.join('/').replace(/\.json$/, '');
    return { type, orgSlug, slug };
  }

  if (type === 'integrations') {
    // integrations/[@org/]slug/config.json
    const slug = rest[0];
    return { type, orgSlug, slug };
  }

  if (type === 'providers') {
    // providers/[@org/]name.json
    const filename = rest[0];
    return { type, orgSlug, slug: filename.replace(/\.json$/, '') };
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
