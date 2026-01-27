import { stringify } from "yaml";
import type {
  ComposeConfig,
  DeploymentColor,
  ServiceConfig,
} from "./types";
import { createDbService } from "./services/db";
import { createGraphDbService } from "./services/graph-db";
import { createProxyService } from "./services/proxy";
import { createPlatformService } from "./services/platform";
import { createRagService } from "./services/rag";
import { createCrawlerService } from "./services/crawler";
import { createSearchService } from "./services/search";

const VOLUMES = {
  "db-data": { driver: "local" },
  "db-backup": { driver: "local" },
  "rag-data": { driver: "local" },
  "graph-db-data": { driver: "local" },
  "platform-convex-data": { driver: "local" },
  "caddy-data": { driver: "local" },
  "caddy-config": { driver: "local" },
};

const NETWORKS = {
  internal: { driver: "bridge" },
};

export function generateStatefulCompose(
  config: ServiceConfig,
  hostAlias: string
): string {
  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      "graph-db": createGraphDbService(config),
      proxy: createProxyService(config, hostAlias),
    },
    volumes: VOLUMES,
    networks: NETWORKS,
  };

  return stringify(compose);
}

export function generateColorCompose(
  config: ServiceConfig,
  color: DeploymentColor,
  projectName: string
): string {
  const compose: ComposeConfig = {
    services: {
      [`platform-${color}`]: createPlatformService(config, color),
      [`rag-${color}`]: createRagService(config, color),
      [`crawler-${color}`]: createCrawlerService(config, color),
      [`search-${color}`]: createSearchService(config, color),
    },
    volumes: {
      "platform-convex-data": {
        driver: "local",
        external: true,
        name: `${projectName}_platform-convex-data`,
      },
      "caddy-data": {
        driver: "local",
        external: true,
        name: `${projectName}_caddy-data`,
      },
      "rag-data": {
        driver: "local",
        external: true,
        name: `${projectName}_rag-data`,
      },
    },
    networks: {
      internal: {
        external: true,
        name: `${projectName}_internal`,
      },
    },
  };

  return stringify(compose);
}

export function generateFullCompose(
  config: ServiceConfig,
  color: DeploymentColor,
  hostAlias: string
): string {
  const compose: ComposeConfig = {
    services: {
      db: createDbService(config),
      "graph-db": createGraphDbService(config),
      proxy: createProxyService(config, hostAlias),
      [`platform-${color}`]: createPlatformService(config, color),
      [`rag-${color}`]: createRagService(config, color),
      [`crawler-${color}`]: createCrawlerService(config, color),
      [`search-${color}`]: createSearchService(config, color),
    },
    volumes: VOLUMES,
    networks: NETWORKS,
  };

  return stringify(compose);
}
