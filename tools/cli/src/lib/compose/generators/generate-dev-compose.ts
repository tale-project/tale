import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import * as logger from '../../../utils/logger';
import {
  discoverOrgs,
  ORG_DOMAIN_DIRS,
  ORGS_SUBDIR,
} from '../../project/org-dirs';
import { createConvexService } from '../services/create-convex-service';
import { createDbService } from '../services/create-db-service';
import { createPlatformService } from '../services/create-platform-service';
import { createProxyService } from '../services/create-proxy-service';
import { createSandboxEgressService } from '../services/create-sandbox-egress-service';
import { createSandboxLlmGatewayService } from '../services/create-sandbox-llm-gateway-service';
import { createSandboxService } from '../services/create-sandbox-service';
import type { ComposeConfig, ServiceConfig } from '../types';
import { DEV_VOLUME_NAMES } from './constants';

const DEV_COLOR = 'blue' as const;

interface DevComposeOptions {
  /** Project root, used to verify host bind-mount sources exist before
   *  emitting them. Defaults to process.cwd() (which is what `tale dev`
   *  passes implicitly via the deploy-compose temp-file location). */
  projectDir?: string;
}

/**
 * Host org config sources to bind-mount in dev, as `{ slug, relBase }` pairs
 * where the on-disk per-domain dir is `<relBase>/<slug>/<domain>`:
 *   - the `default/` template at the project root (`relBase = '.'`), so
 *     template edits hot-reload, and
 *   - every real org under `.tale/orgs/<slug>/` (`relBase = '.tale/orgs'`).
 */
function orgMountSources(
  projectDir: string,
): { slug: string; relBase: string }[] {
  const sources: { slug: string; relBase: string }[] = [];
  if (existsSync(join(projectDir, 'default'))) {
    sources.push({ slug: 'default', relBase: '.' });
  }
  for (const org of discoverOrgs(projectDir).orgs) {
    sources.push({ slug: org.slug, relBase: ORGS_SUBDIR });
  }
  return sources;
}

/** Return host bind-mount fragments for the org-first layout.
 *
 *  For each org source, emits one mount per domain dir that actually exists:
 *  `./<relBase>/<slug>/<domain>:<containerBase>/<slug>/<domain>{ro}`. The
 *  container path is always `/app/data/<slug>/<domain>` regardless of where
 *  the host dir lives. Missing per-domain dirs are skipped silently; a
 *  workspace with no org sources at all logs a single warning. */
function existingHostMounts(
  projectDir: string,
  containerBase: string,
  suffix = '',
): string[] {
  const sources = orgMountSources(projectDir);
  if (sources.length === 0) {
    logger.warn(
      `No org config found under ${projectDir}. Container will fall back to convex-data volume contents — host edits will not hot-reload.`,
    );
    return [];
  }
  const mounts: string[] = [];
  for (const { slug, relBase } of sources) {
    for (const domain of ORG_DOMAIN_DIRS) {
      const src = join(projectDir, relBase, slug, domain);
      if (existsSync(src)) {
        const hostPath =
          relBase === '.'
            ? `./${slug}/${domain}`
            : `./${relBase}/${slug}/${domain}`;
        mounts.push(`${hostPath}:${containerBase}/${slug}/${domain}${suffix}`);
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
      'sandbox-llm-gateway': createSandboxLlmGatewayService(config),
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
