import { stringify } from "yaml";
import type { ComposeConfig, ServiceConfig } from "../types";
import { createDbService } from "../services/create-db-service";
import { createGraphDbService } from "../services/create-graph-db-service";
import { createProxyService } from "../services/create-proxy-service";
import { NETWORKS, VOLUMES } from "./constants";

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
