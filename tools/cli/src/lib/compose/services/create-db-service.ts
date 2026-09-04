import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

export function createDbService(config: ServiceConfig): ComposeService {
  return {
    image: imageRef(config, 'db'),
    container_name: `${getProjectId()}-db`,
    // SIGINT = PostgreSQL's *fast* shutdown (disconnect every client,
    // checkpoint, exit cleanly). Docker's default SIGTERM is the *smart*
    // shutdown, which waits for every client session to end — with a backend
    // or psql holding connections it never finishes, and Docker SIGKILLs the
    // server after the grace period: a crash-mode stop that left a
    // never-initialised page in pg_search's BM25 index (PANIC on every write).
    // The tale-db image sets the same STOPSIGNAL; this covers an older image.
    // Keep in lockstep with the canonical compose.yml db service.
    stop_signal: 'SIGINT',
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
    // The single-node CLI stack folds the knowledge corpus (`tale_knowledge`)
    // into this one Postgres: the tale-db image creates that DB + the
    // pg_search/pgvector schemas on init, and applies the knowledge-corpus
    // migrations because `TALE_DB_ROLE` defaults to `knowledge` (no override
    // is set here or in .env). The split `compose.yml` runs a SEPARATE
    // `knowledge-db` service, so the in-process RAG/crawler code resolves its
    // datastore at host `knowledge-db` by default
    // (the backend resolves it via getKnowledgeDatabaseUrl). We
    // alias this service to `knowledge-db` so that same default URL resolves
    // here, with no extra env wiring — keeping the runtime identical across
    // both topologies.
    networks: { internal: { aliases: ['knowledge-db'] } },
  };
}
