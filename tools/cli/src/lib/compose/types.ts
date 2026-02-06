interface LoggingConfig {
  driver: string;
  options: Record<string, string>;
}

export const DEFAULT_LOGGING: LoggingConfig = {
  driver: "json-file",
  options: {
    "max-size": "10m",
    "max-file": "3",
  },
};

export interface ComposeService {
  image: string;
  container_name?: string;
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
}

export interface ComposeConfig {
  services: Record<string, ComposeService>;
  volumes?: Record<string, { driver?: string; external?: boolean; name?: string }>;
  networks?: Record<string, { driver?: string; external?: boolean; name?: string }>;
}

export type DeploymentColor = "blue" | "green";

export interface ServiceConfig {
  version: string;
  registry: string;
  projectName: string;
}

export const ROTATABLE_SERVICES = ["platform", "rag", "crawler", "operator"] as const;
export const STATEFUL_SERVICES = ["db", "graph-db", "proxy"] as const;
export const ALL_SERVICES = [...ROTATABLE_SERVICES, ...STATEFUL_SERVICES] as const;

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
