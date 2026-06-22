import { stringify } from 'yaml';

import { getProjectId } from '../../../utils/load-env';
import { createSandboxEgressService } from '../services/create-sandbox-egress-service';
import { createSandboxService } from '../services/create-sandbox-service';
import type { ComposeConfig, DeploymentColor, ServiceConfig } from '../types';

/**
 * Compose for ONE colour of the blue-green sandbox tier: a colour-suffixed
 * spawner (`sandbox-<color>`) + its own egress sidecar (`sandbox-egress-<color>`)
 * on the shared `tale-sandbox-net`. The deploy flip brings up the inactive
 * colour with this, moves the bare `sandbox` network alias onto it once healthy,
 * drains the old colour via `/v1/drain`, then tears the old colour down.
 *
 * The egress's container-local IMDS/RFC1918 iptables fence runs per-colour, so
 * each colour keeps the full SSRF posture independently.
 */
export function generateSandboxColorCompose(
  config: ServiceConfig,
  color: DeploymentColor,
): string {
  const prefix = `${getProjectId()}_`;
  const compose: ComposeConfig = {
    services: {
      // Egress first so the spawner's `depends_on: service_healthy` resolves.
      [`sandbox-egress-${color}`]: createSandboxEgressService(config, color),
      [`sandbox-${color}`]: createSandboxService(config, color),
    },
    volumes: {
      // Spawner mounts the shared deployment config read-only (sandboxRuntime
      // tier). Same external volume as the stateful compose.
      'convex-data': { external: true, name: `${prefix}convex-data` },
    },
    networks: {
      internal: { external: true, name: `${prefix}internal` },
      // Shared across colours and dev/prod; pinned name so spawned runtime
      // containers can `--network tale-sandbox-net` directly.
      sandbox: { external: true, name: 'tale-sandbox-net' },
    },
  };

  return stringify(compose);
}
