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
  stop_grace_period?: string;
  shm_size?: string;
  ports?: string[];
  volumes?: string[];
  env_file?: string[];
  environment?: Record<string, string>;
  restart?: string;
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period?: string;
  };
  depends_on?: string[] | Record<string, { condition: string }>;
  logging?: LoggingConfig;
  networks?: string[] | Record<string, { aliases?: string[] }>;
  extra_hosts?: string[];
  // Linux capability + resource flags. Previously absent from the generator,
  // which silently dropped them on the convex service (R1.17 latent bug)
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
/**
 * Sandbox tier — the spawner and its egress proxy. Kept in STATEFUL_SERVICES so
 * `isStatefulService` / `isValidService` still recognize them as real service
 * names, but they are NOT rolled through the stateful compose path: a default
 * `tale deploy` rolls them via their own zero-gap blue-green flip
 * (`flipSandboxTier`, in lockstep with platform's colour). The wire protocol
 * versions with platform, so an old sandbox image against new platform code
 * would fail with HARVEST_FAILED on the first run — hence the lockstep flip.
 */
const SANDBOX_TIER_SERVICES = ['sandbox', 'sandbox-egress'] as const;
export const STATEFUL_SERVICES = [
  'db',
  'proxy',
  'convex',
  // Listed only for service-name recognition (isStatefulService /
  // isValidService); the default deploy rolls these via flipSandboxTier,
  // never through the stateful compose path.
  ...SANDBOX_TIER_SERVICES,
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
 * default deploy. `convex` must never version-skew from platform but can't be
 * two-color (it owns the single `convex-data` volume), so it's recreated in
 * place and only when its image actually changed. `sandbox` / `sandbox-egress`
 * are NOT here: they roll through their own zero-gap blue-green flip
 * (`flipSandboxTier`, alongside platform's colour), not the stateful path.
 */
export const ALWAYS_ROLL_SERVICES = ['convex'] as const;

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
