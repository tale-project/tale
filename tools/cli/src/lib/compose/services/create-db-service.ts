import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

export function createDbService(config: ServiceConfig): ComposeService {
  return {
    image: `${config.registry}/tale-db:${config.version}`,
    container_name: `${getProjectId()}-db`,
    stop_grace_period: '60s',
    shm_size: '256mb',
    volumes: [
      'db-data:/var/lib/postgresql/data',
      'db-backup:/var/lib/postgresql/backup',
    ],
    env_file: ['.env'],
    restart: 'unless-stopped',
    // Gate dependents on BOTH PostgreSQL accepting connections AND the
    // post-start init scripts finishing (they create `tale_knowledge` +
    // extensions and run migrations in the background, so `pg_isready` alone
    // races init on a fresh volume / slow disk). The tale-db image touches
    // `/tmp/.db_ready` once init completes (services/db/docker-entrypoint.sh).
    // Without the marker + a long enough start_period, the first cold boot
    // could flip the db `unhealthy` and abort `docker compose up` with
    // "dependency failed to start: container ...-db is unhealthy" (#1411).
    // Keep this in lockstep with the canonical compose.yml db healthcheck.
    healthcheck: {
      test: [
        'CMD-SHELL',
        'pg_isready -U ${POSTGRES_USER:-tale} -d ${POSTGRES_DB:-tale} && [ -f /tmp/.db_ready ]',
      ],
      interval: '5s',
      timeout: '10s',
      retries: 3,
      start_period: '120s',
    },
    logging: DEFAULT_LOGGING,
    networks: ['internal'],
  };
}
