import { existsSync, readdirSync, statSync } from 'node:fs';
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
import { createSandboxEgressService } from '../services/create-sandbox-egress-service';
import { createSandboxService } from '../services/create-sandbox-service';
import type { ComposeConfig, ServiceConfig } from '../types';
import { DEV_VOLUME_NAMES } from './constants';

const DEV_COLOR = 'blue' as const;
/** Domain dirs that the org-first layout uses under `<projectDir>/<org>/`. */
const HOST_DOMAIN_DIRS = [
  'agents',
  'workflows',
  'integrations',
  'branding',
  'providers',
  'skills',
] as const;
/** Org-slug regex aligned with the platform-side validator. Refuses dotfiles
 *  and any non-org-shaped dir at the project root (`.tale`, `.git`, etc.). */
const ORG_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

interface DevComposeOptions {
  /** Project root, used to verify host bind-mount sources exist before
   *  emitting them. Defaults to process.cwd() (which is what `tale start`
   *  passes implicitly via the deploy-compose temp-file location). */
  projectDir?: string;
}

/** Discover org subdirectories (`<projectDir>/<org>/`) by enumerating the
 *  project root. Every direct subdir whose name matches the org-slug regex
 *  is an org. `tale init` always creates at least `default/`. */
function findOrgDirs(projectDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(projectDir);
  } catch {
    return [];
  }
  const orgs: string[] = [];
  for (const name of entries) {
    if (!ORG_SLUG_RE.test(name)) continue;
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(join(projectDir, name));
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    orgs.push(name);
  }
  return orgs;
}

/** Return host bind-mount fragments for the org-first layout.
 *
 *  For each org `<root>/<org>/`, emits one mount per domain dir that
 *  actually exists: `./<org>/<domain>:<containerBase>/<org>/<domain>{ro}`.
 *  Missing per-domain dirs are skipped silently (operators don't have to
 *  populate every domain), but a `tale init` workspace with no org dirs
 *  at all logs a single warning. */
function existingHostMounts(
  projectDir: string,
  containerBase: string,
  suffix = '',
): string[] {
  const orgs = findOrgDirs(projectDir);
  if (orgs.length === 0) {
    logger.warn(
      `No org directories found under ${projectDir}. Container will fall back to convex-data volume contents — host edits will not hot-reload.`,
    );
    return [];
  }
  const mounts: string[] = [];
  for (const org of orgs) {
    for (const domain of HOST_DOMAIN_DIRS) {
      const src = join(projectDir, org, domain);
      if (existsSync(src)) {
        mounts.push(
          `./${org}/${domain}:${containerBase}/${org}/${domain}${suffix}`,
        );
      }
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

  // RAG/crawler need convex-data:/app/platform-config:ro for per-org
  // provider config (and integrations, branding, …). The org-first
  // layout has paths like `default/providers/foo.json`, all under one
  // root, so the previous standalone `./providers:/app/platform-config/providers:ro`
  // shadow is no longer needed — the per-org bind mounts below cover
  // host-edit hot reload for every org's provider catalog.
  const rag = createRagService(config, DEV_COLOR);
  rag.container_name = `${getProjectId()}-rag`;
  rag.volumes = [
    'rag-data:/app/data',
    'convex-data:/app/platform-config:ro',
    ...existingHostMounts(projectDir, '/app/platform-config', ':ro'),
  ];

  const crawler = createCrawlerService(config, DEV_COLOR);
  crawler.container_name = `${getProjectId()}-crawler`;
  crawler.volumes = [
    'crawler-data:/app/data',
    'convex-data:/app/platform-config:ro',
    ...existingHostMounts(projectDir, '/app/platform-config', ':ro'),
  ];

  const proxy = createProxyService(config, hostAlias);
  proxy.ports = [`${port}:443`];

  // Dev-only: publish the sandbox spawner on host loopback so `bun dev`
  // running Convex on the host can reach it at http://127.0.0.1:8003. The
  // stateful compose generator never publishes this port — production Convex
  // is in-container and uses the `internal` Docker network alias.
  const sandbox = createSandboxService(config);
  sandbox.ports = ['127.0.0.1:8003:8003'];

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
      'sandbox-egress': createSandboxEgressService(config),
      sandbox,
    },
    volumes,
    networks: {
      internal: {
        external: true,
        name: `${devPrefix}internal`,
      },
      // Sandbox bridge — internal-only, IPv6 disabled (declared in
      // start.ts via ensureNetwork; here referenced as external so the
      // generator emits the right ref).
      sandbox: { external: true, name: 'tale-sandbox-net' },
    },
  };

  return stringify(compose);
}
