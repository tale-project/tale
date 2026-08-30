interface LoggingConfig {
  driver: string;
  options: Record<string, string>;
}

export const DEFAULT_LOGGING: LoggingConfig = {
  driver: 'json-file',
  options: {
    'max-size': '10m',
    'max-file': '3',
  },
};

export interface ComposeService {
  image: string;
  container_name?: string;
  // `init: true` runs an init process (PID 1 reaper) — needed by sidecars that
  // spawn short-lived child processes (e.g. the bgutil provider's headless
  // workers). `pull_policy` is emitted for third-party images not built here.
  init?: boolean;
  pull_policy?: string;
  // Overrides the image's default CMD — third-party images that need flags
  // (the object store's address + data dir) rather than a baked entrypoint.
  command?: string;
  stop_grace_period?: string;
  shm_size?: string;
  ports?: string[];
  volumes?: string[];
  env_file?: string[];
  environment?: Record<string, string>;
  restart?: string;
  healthcheck?:
    | {
        test: string[];
        interval: string;
        timeout: string;
        retries: number;
        start_period?: string;
      }
    // A service with no HTTP surface (the job worker) disables the image's
    // baked healthcheck rather than reading permanently unhealthy.
    | { disable: true };
  depends_on?: string[] | Record<string, { condition: string }>;
  logging?: LoggingConfig;
  networks?: string[] | Record<string, { aliases?: string[] }>;
  extra_hosts?: string[];
  // Linux capability + resource flags. Previously absent from the generator,
  // which silently dropped them on the retired convex service (R1.17 latent bug)
  // and made sandbox impossible. All optional; emit only when set.
  cap_add?: string[];
  cap_drop?: string[];
  mem_limit?: string;
  pids_limit?: number;
  ulimits?: Record<string, number | { soft: number; hard: number }>;
  security_opt?: string[];
  runtime?: string;
}

export interface ComposeConfig {
  services: Record<string, ComposeService>;
  volumes?: Record<
    string,
    { driver?: string; external?: boolean; name?: string }
  >;
  networks?: Record<
    string,
    { driver?: string; external?: boolean; name?: string }
  >;
}

export type DeploymentColor = 'blue' | 'green';

export interface ServiceConfig {
  version: string;
  registry: string;
}

export const ROTATABLE_SERVICES = ['platform'] as const;

/** The application backend tier — named once and spread into every list
 *  below, so the deploy flow and the drain lane cannot drift apart. */
const BACKEND_TIER_SERVICES = ['backend-api', 'backend-worker'] as const;

export const STATEFUL_SERVICES = [
  'db',
  'proxy',
  'sandbox-llm-gateway',
  // Sandbox tier — the single spawner and its egress proxy. Rolled in place
  // through the stateful compose on every default deploy (see
  // ALWAYS_ROLL_SERVICES); a serialized /v1/drain (drainSandbox) runs first.
  'sandbox',
  'sandbox-egress',
  // The application backend tier: the api that serves every door and the
  // worker that runs the jobs.
  ...BACKEND_TIER_SERVICES,
] as const;
export const ALL_SERVICES = [
  ...ROTATABLE_SERVICES,
  ...STATEFUL_SERVICES,
] as const;

/**
 * Stop-gated tier — data/proxy infrastructure that is NOT rolled on a default
 * deploy while it's running. A running stop-gated container is left untouched
 * (with a warning) unless the operator opts into the downtime with
 * `tale deploy --stop` (or it's already stopped, or it's a first deploy),
 * because recreating Postgres / the proxy means an availability blip that a
 * routine app-tier roll shouldn't incur.
 */
export const STOP_GATED_SERVICES = ['db', 'proxy'] as const;
/**
 * Always-roll-in-place tier — deployed via the stateful compose on EVERY
 * default deploy. `sandbox-llm-gateway` is a singleton that owns the single
 * `llm-gateway-data` volume, so it is recreated in place and only when its
 * image actually changed. `sandbox` / `sandbox-egress` are the
 * single-container sandbox tier (blue-green dropped): they roll in place too,
 * drained first via /v1/drain (drainSandbox, deploy.ts). The wire protocol
 * versions with platform, so they must roll on every deploy.
 */
export const ALWAYS_ROLL_SERVICES = [
  'sandbox-llm-gateway',
  'sandbox',
  'sandbox-egress',
  // The backend ships the SAME image as platform and shares its wire
  // contracts, so it must never version-skew from it: rolled in place on
  // every deploy, drained first (drain-backend.ts).
  ...BACKEND_TIER_SERVICES,
] as const;

export type RotatableService = (typeof ROTATABLE_SERVICES)[number];
export type StatefulService = (typeof STATEFUL_SERVICES)[number];
export type StopGatedService = (typeof STOP_GATED_SERVICES)[number];
export type ServiceName = RotatableService | StatefulService;

export function isValidService(name: string): name is ServiceName {
  return (ALL_SERVICES as readonly string[]).includes(name);
}

export function isRotatableService(name: string): name is RotatableService {
  return (ROTATABLE_SERVICES as readonly string[]).includes(name);
}

export function isStatefulService(name: string): name is StatefulService {
  return (STATEFUL_SERVICES as readonly string[]).includes(name);
}
