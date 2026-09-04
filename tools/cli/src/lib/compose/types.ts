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
  // The signal `docker stop` sends before the grace period runs out. Postgres
  // reads SIGINT as its fast shutdown; the SIGTERM default (smart shutdown)
  // waits on every attached client and ends in SIGKILL — see
  // create-db-service.ts.
  stop_signal?: string;
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
  // The blob store: S3 is the only blob backend, so a deployment without one
  // refuses every upload. Left out of this list, `tale deploy`'s explicit
  // `up -d <services…>` never started it at all.
  'object-store',
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
export const STOP_GATED_SERVICES = ['db', 'object-store', 'proxy'] as const;
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

/**
 * Services that run a pinned THIRD-PARTY image instead of a `tale-*` one from
 * our registry. The pin lives here — the single source the compose creators
 * and the deploy pull list share.
 */
export const THIRD_PARTY_IMAGES = {
  'object-store': 'minio/minio:RELEASE.2025-04-22T22-12-26Z',
} as const satisfies Partial<Record<ServiceName, string>>;

/**
 * The `tale-*` image repository a service runs, without the registry prefix.
 * Every service ships its own `tale-<service>` image EXCEPT the backend tier,
 * which runs the platform image (`TALE_ROLE` picks api/worker at boot) —
 * deriving the repository mechanically from the service name invents images
 * that were never built. Callers wanting a pullable reference use `imageRef`,
 * which also covers the third-party services this function does not.
 */
export function imageRepoForService(
  service: Exclude<ServiceName, keyof typeof THIRD_PARTY_IMAGES>,
): string {
  return (BACKEND_TIER_SERVICES as readonly string[]).includes(service)
    ? 'tale-platform'
    : `tale-${service}`;
}

/** The full image reference a service runs under the given registry+version. */
export function imageRef(
  config: Pick<ServiceConfig, 'registry' | 'version'>,
  service: ServiceName,
): string {
  if (service in THIRD_PARTY_IMAGES) {
    return THIRD_PARTY_IMAGES[service as keyof typeof THIRD_PARTY_IMAGES];
  }
  return `${config.registry}/${imageRepoForService(service as Exclude<ServiceName, keyof typeof THIRD_PARTY_IMAGES>)}:${config.version}`;
}
