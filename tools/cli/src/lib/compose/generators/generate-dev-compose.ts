import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import * as logger from '../../../utils/logger';
import { createConvexService } from '../services/create-convex-service';
import { createCrawlerService } from '../services/create-crawler-service';
import { createDbService } from '../services/create-db-service';
import { createPlatformService } from '../services/create-platform-service';
import { createProxyService } from '../services/create-proxy-service';
import { createRagService } from '../services/create-rag-service';
import type { ComposeConfig, ServiceConfig } from '../types';
import { DEV_VOLUME_NAMES } from './constants';

const DEV_COLOR = 'blue' as const;
/** Project-root subdirs that `tale init` populates from embedded examples. */
const HOST_CONFIG_DIRS = [
  'agents',
  'workflows',
  'integrations',
  'branding',
  'providers',
] as const;

interface DevComposeOptions {
  fresh?: boolean;
  /** Project root, used to verify host bind-mount sources exist before
   *  emitting them. Defaults to process.cwd() (which is what `tale start`
   *  passes implicitly via the deploy-compose temp-file location). */
  projectDir?: string;
}

/** Return host bind-mount fragments (e.g. './agents:/app/data/agents{ro}')
 *  only for directories that actually exist on the host, with one warning
 *  per missing directory so the operator can fix it without docker emitting
 *  a confusing 'no such file or directory' error. */
function existingHostMounts(
  projectDir: string,
  containerBase: string,
  suffix = '',
): string[] {
  const mounts: string[] = [];
  for (const dir of HOST_CONFIG_DIRS) {
    if (existsSync(join(projectDir, dir))) {
      mounts.push(`./${dir}:${containerBase}/${dir}${suffix}`);
    } else {
      logger.warn(
        `Skipping host bind mount for ./${dir} (directory not found in project root). Container will fall back to convex-data volume contents.`,
      );
    }
  }
  return mounts;
}

export function generateDevCompose(
  config: ServiceConfig,
  hostAlias: string,
  port: number,
  options: DevComposeOptions = {},
): string {
  const projectDir = options.projectDir ?? process.cwd();

  // Convex service owns the /app/data volume in Phase 2.
  const convex = createConvexService(config);
  convex.container_name = `${getProjectId()}-convex`;
  convex.volumes = [
    'convex-data:/app/data',
    // Dev overrides: live bind-mount tale-init-populated dirs so edits on
    // the host are visible to the Convex actions that read them. Only
    // emitted when the directory actually exists on disk.
    ...existingHostMounts(projectDir, '/app/data'),
    'caddy-data:/caddy-data:ro',
  ];
  convex.depends_on = { db: { condition: 'service_healthy' } };
  if (options.fresh) {
    convex.environment = { ...convex.environment, FORCE_SEED: 'true' };
  }

  // Platform becomes a thin client.
  //
  // Read-only mount of `convex-data` for server.ts (config SSE watcher +
  // branding image serving). In dev we ALSO bind-mount the same host-side
  // dirs that convex sees, so that:
  //   - host edits to ./agents/foo.json fire chokidar events in platform
  //     (named-volume-only mounts wouldn't see bind-mount overlays from a
  //     sibling container — bind mounts shadow but don't write through to
  //     the underlying named volume).
  //   - server.ts can serve branding images from the same bytes the convex
  //     functions read.
  const platform = createPlatformService(config, DEV_COLOR);
  platform.container_name = `${getProjectId()}-platform`;
  platform.volumes = [
    'convex-data:/app/data:ro',
    ...existingHostMounts(projectDir, '/app/data', ':ro'),
  ];
  // TALE_CONFIG_DIR is the only file-config path platform needs to push to
  // Convex (sub-dirs are derived in convex/*/file_utils.ts). Platform also
  // needs it locally for server.ts (chokidar root + branding image dir).
  platform.environment = {
    TALE_CONFIG_DIR: '/app/data',
    TALE_FILE_EVENTS: 'true',
    CONVEX_URL: 'http://convex:3210',
  };
  platform.depends_on = {
    db: { condition: 'service_healthy' },
    convex: { condition: 'service_healthy' },
  };

  const providersBindMount = existsSync(join(projectDir, 'providers'))
    ? './providers:/app/platform-config/providers:ro'
    : null;

  // RAG/crawler need convex-data:/app/platform-config:ro for non-provider
  // config (integrations, branding, …). The providers bind mount is a more
  // specific path and shadows just providers/ for host-edit hot reload.
  const rag = createRagService(config, DEV_COLOR);
  rag.container_name = `${getProjectId()}-rag`;
  rag.volumes = [
    'rag-data:/app/data',
    'convex-data:/app/platform-config:ro',
    ...(providersBindMount ? [providersBindMount] : []),
  ];

  const crawler = createCrawlerService(config, DEV_COLOR);
  crawler.container_name = `${getProjectId()}-crawler`;
  crawler.volumes = [
    'crawler-data:/app/data',
    'convex-data:/app/platform-config:ro',
    ...(providersBindMount ? [providersBindMount] : []),
  ];

  const proxy = createProxyService(config, hostAlias);
  proxy.ports = [`${port}:443`];

  // Scope dev volumes/networks explicitly via `external: true` + `name:`.
  // Dev volumes live under the `${projectId}-dev_` prefix (matching the
  // `-p ${projectId}-dev` passed to docker compose). They are pre-created by
  // `ensureVolumes` / `ensureNetwork` in start.ts so the compose-level
  // reference is valid even if someone runs `docker compose` by hand.
  const devPrefix = `${getProjectId()}-dev_`;
  const volumes: Record<string, { external: true; name: string }> = {};
  for (const name of DEV_VOLUME_NAMES) {
    volumes[name] = { external: true, name: `${devPrefix}${name}` };
  }

  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      proxy,
      convex,
      platform,
      rag,
      crawler,
    },
    volumes,
    networks: {
      internal: {
        external: true,
        name: `${devPrefix}internal`,
      },
    },
  };

  return stringify(compose);
}
