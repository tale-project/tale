import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

const MIB = 1024 ** 2;
/** The gateway and its provider workers before any session runs, in MiB. */
const GATEWAY_BASE_MIB = 256;
/**
 * What each session that runs at once may add, in MiB: its virtual key and
 * the request and answer buffers of its model calls, which Go's collector lets
 * grow to twice what is live (the image sets no GOMEMLIMIT). 512 MiB ran out
 * at about 80 sessions, 6.4 MiB a session with the base counted in; 12 MiB is
 * about twice that, and gives the 4 GiB that held a deployment of 320.
 */
const GATEWAY_SESSION_MIB = 12;
/** The least the gateway gets, in MiB: its fixed limit before it followed the
 * capacity, which holds the spawner's default of 8 sessions. */
const GATEWAY_MIN_MIB = 512;
/**
 * The sessions an unset SANDBOX_MAX_SESSIONS is sized for: the spawner then
 * sizes its capacity from the host's memory when it boots, at most 256
 * (autoSessionCapacity, services/sandbox/src/host-memory.ts), which this
 * generator cannot see.
 */
const UNSET_CAPACITY_SESSIONS = 256;

/**
 * The sessions the spawner runs at once: SANDBOX_MAX_SESSIONS read the way the
 * spawner reads it (numEnv in services/sandbox/src/config.ts, which the CLI
 * cannot import), else the most an unset capacity sizes itself to. A value the
 * spawner would refuse at boot fails the compose generation instead, before
 * any container is recreated.
 */
function sessionCapacity(): number {
  const name = 'SANDBOX_MAX_SESSIONS';
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return UNSET_CAPACITY_SESSIONS;
  }
  const sessions = Number(value);
  if (!Number.isFinite(sessions)) {
    throw new Error(
      `Env var ${name} is not a finite number: ${JSON.stringify(value)}`,
    );
  }
  if (sessions < 1) {
    throw new Error(`Env var ${name} must be >= 1; got: ${sessions}`);
  }
  return Math.ceil(sessions);
}

/**
 * The gateway's memory limit, in whole MiB: SANDBOX_LLM_GATEWAY_MEMORY when
 * set, a size such as 4g or 4096m and at least 512 MiB; else the base and a
 * share for each session of the capacity, at least 512 MiB. It is a cap, not
 * a reservation, so headroom costs an idle gateway nothing. The shipped
 * compose.yml hands the same variable to mem_limit as it is, so this takes
 * only spellings compose takes too: not the Kubernetes 4Gi that the spawner's
 * own sizes (sizeEnv in services/sandbox/src/config.ts) also read.
 */
function gatewayMemoryLimit(): string {
  const name = 'SANDBOX_LLM_GATEWAY_MEMORY';
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    const derived = GATEWAY_BASE_MIB + GATEWAY_SESSION_MIB * sessionCapacity();
    return `${Math.max(GATEWAY_MIN_MIB, derived)}m`;
  }
  const m = /^(\d+)([kmg]?)b?$/i.exec(value);
  const unit = { '': 1, k: 1024, m: MIB, g: 1024 * MIB }[
    (m?.[2] ?? '').toLowerCase()
  ];
  const bytes = Number(m?.[1]) * (unit ?? 1);
  // NaN when it is no size; past 2^53 bytes the limit would print in exponent
  // notation, which compose refuses.
  if (!Number.isSafeInteger(bytes)) {
    throw new Error(
      `Env var ${name} is not a size such as 4g or 4096m: ${JSON.stringify(value)}`,
    );
  }
  if (bytes < GATEWAY_MIN_MIB * MIB) {
    throw new Error(
      `Env var ${name} must be at least 512m; got: ${JSON.stringify(value)}`,
    );
  }
  return `${Math.floor(bytes / MIB)}m`;
}

/**
 * Sandbox LLM gateway service. Fronts every model provider with a single
 * OpenAI-compatible endpoint, mints per-session virtual keys, and is the
 * single source of truth for usage accounting for in-sandbox coding agents.
 * Built on the upstream maximhq/bifrost core.
 *
 * Joined to BOTH networks:
 *   - `internal` — so the platform / convex containers can reach it on
 *     http://sandbox-llm-gateway:8080.
 *   - `sandbox` — so in-sandbox agents routed through EXTERNAL_AGENT_GATEWAY_URL
 *     can reach the gateway from the sandbox bridge.
 *
 * The data volume keeps its pre-rename name (`llm-gateway-data`) so the service
 * rename needs no data migration of its SQLite store, which holds what the
 * platform cannot re-derive (the admin account, minted keys with their spend,
 * the request log) and which snapshots capture (GATEWAY_VOLUME in
 * ../../backup/constants.ts). The transitional `llm-gateway` network
 * alias keeps the old hostname resolving for one release so in-flight sessions
 * survive the deploy that lands the rename.
 *
 * The `.env` it reads carries SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD, which the
 * gateway image turns into its setup token: a fresh gateway creates its admin
 * account only for a platform that presents it.
 *
 * Its memory grows with the sessions that run at once (a fixed 512 MiB was
 * OOM-killed every 40 s at about 80), so its limit follows the deployment's
 * capacity (gatewayMemoryLimit): SANDBOX_LLM_GATEWAY_MEMORY when set, else
 * 256 MiB and 12 MiB for each session of SANDBOX_MAX_SESSIONS, at least
 * 512 MiB. compose.yml, and the managed deployments built from it, cannot
 * derive one variable from another, so there the default is the one this
 * builder gives an unset capacity.
 */
export function createSandboxLlmGatewayService(
  config: ServiceConfig,
): ComposeService {
  return {
    image: imageRef(config, 'sandbox-llm-gateway'),
    container_name: `${getProjectId()}-sandbox-llm-gateway`,
    env_file: ['.env'],
    restart: 'unless-stopped',
    // Graceful drain on stop: on SIGTERM the gateway stops taking new calls
    // and waits for the ones in flight (streamed answers included) to finish.
    // It writes its in-memory budget counters, the spend the platform books,
    // to its store only when that drain ends within 30s of the signal, its
    // own cleanup window. Docker's 10s default would cut every model stream
    // still running 10s into a deploy's stop; 90s lets an ordinary model call
    // finish.
    stop_grace_period: '90s',
    mem_limit: gatewayMemoryLimit(),
    volumes: ['llm-gateway-data:/app/data'],
    healthcheck: {
      test: [
        'CMD-SHELL',
        'wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1',
      ],
      interval: '10s',
      timeout: '5s',
      retries: 3,
      start_period: '15s',
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: { aliases: ['llm-gateway'] },
      sandbox: { aliases: ['llm-gateway'] },
    },
  };
}
