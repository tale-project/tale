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

export const ROTATABLE_SERVICES = ['platform', 'rag', 'crawler'] as const;
export const STATEFUL_SERVICES = [
  'db',
  'proxy',
  'convex',
  // Sandbox spawner + egress proxy — singleton, no blue/green rotation
  // (state is per-call container, not per-replica). Bundled into the
  // stateful bucket because they live alongside db/convex/proxy in
  // deploy.ts:auto-include-missing logic.
  'sandbox',
  'sandbox-egress',
] as const;
export const ALL_SERVICES = [
  ...ROTATABLE_SERVICES,
  ...STATEFUL_SERVICES,
] as const;

export type RotatableService = (typeof ROTATABLE_SERVICES)[number];
export type StatefulService = (typeof STATEFUL_SERVICES)[number];
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
