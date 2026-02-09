export const VOLUMES = {
  'db-data': { driver: 'local' },
  'db-backup': { driver: 'local' },
  'rag-data': { driver: 'local' },
  'graph-db-data': { driver: 'local' },
  'platform-convex-data': { driver: 'local' },
  'caddy-data': { driver: 'local' },
  'caddy-config': { driver: 'local' },
};

export const NETWORKS = {
  internal: { driver: 'bridge' },
};
