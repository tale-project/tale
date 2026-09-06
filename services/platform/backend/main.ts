import { serve } from '@hono/node-server';

import { PatternRegistry } from '../lib/pii';
import { createApp } from './app.ts';
import { createAuth, type Auth } from './auth/auth.ts';
import { runBootMigrations } from './db/migrate.ts';
import { createSql } from './db/sql.ts';
import {
  installCorpusHealthHook,
  verifyDefaultKnowledgeIndexes,
} from './domains/knowledge/index-health.ts';
import { ensureDefaultCorpusSchema } from './domains/knowledge/service.ts';
import { ensureDefaultObjectStore } from './domains/object_storage/bootstrap.ts';
import { seedDevUser } from './domains/provisioning/dev-seed.ts';
import { loadEnv } from './env.ts';
import {
  flushErrorReporting,
  initErrorReporting,
  reportError,
} from './error-reporting.ts';
import { closeServerGracefully } from './http-shutdown.ts';
import { createBoss, ensureQueues } from './jobs/boss.ts';
import { setEnqueueBoss } from './jobs/enqueue.ts';
import { startWorker } from './jobs/runner.ts';
import { registerSchedules } from './jobs/schedules.ts';
import { createTaskList } from './jobs/task-list.ts';
import { initBackendTelemetry } from './telemetry.ts';

async function main(): Promise<void> {
  const env = loadEnv();
  // First thing after the env parse, so even a failing boot (migrations, DB
  // connectivity) reports before the process dies. No-op without SENTRY_DSN.
  initErrorReporting({ dsn: env.SENTRY_DSN, role: env.ROLE });
  const needsApi = env.ROLE !== 'worker';
  const sql = createSql(env.DATABASE_URL);

  let auth: Auth | null = null;
  if (needsApi) {
    if (!env.BETTER_AUTH_SECRET) {
      throw new Error(
        `BETTER_AUTH_SECRET is required for role '${env.ROLE}' (only a pure worker boots without it)`,
      );
    }
    auth = createAuth({
      databaseUrl: env.DATABASE_URL,
      secret: env.BETTER_AUTH_SECRET,
      baseUrl: env.SITE_URL,
      sql,
    });
  }

  // App SQL migrations run in every role (workers write app tables too);
  // auth-table migrations run wherever auth is configured. The migrator's
  // advisory lock serializes concurrently booting containers.
  await runBootMigrations({
    databaseUrl: env.DATABASE_URL,
    ...(auth ? { authOptions: auth.options } : {}),
  });

  // Metrics collectors need the pool and read app tables, so they register
  // once per process AFTER the schema is known to exist.
  initBackendTelemetry(sql);

  // pg-boss migrates its own `pgboss` schema on start (advisory-locked).
  // Every role sends jobs, so every role starts an instance; queue
  // maintenance (supervise) runs on workers only.
  const boss = createBoss(env.DATABASE_URL, { supervise: env.ROLE !== 'api' });
  await boss.start();
  await ensureQueues(boss);
  setEnqueueBoss(boss);

  // Per-org BYO corpora bootstrap on first use inside the pool router; the
  // hook verifies (and repairs) their BM25 indexes in that same single flight.
  installCorpusHealthHook(sql);
  if (env.ROLE !== 'api') {
    // The deployment-default knowledge corpus bootstraps itself.
    await ensureDefaultCorpusSchema().catch((error: unknown) => {
      console.warn('[backend] default corpus bootstrap failed:', error);
      reportError(error, { tags: { 'tale.lane': 'boot' } });
    });
  }
  // Every role verifies the default corpus's BM25 indexes BEFORE a job or a
  // request can write to them: a block zeroed by a crash-mode stop makes every
  // chunk insert PANIC the database, and the rebuild is lossless. An advisory
  // lock on the knowledge database leaves the repair to one process; the
  // others skip. Never fails boot — the report is logged, audited, and belled.
  await verifyDefaultKnowledgeIndexes(sql).catch((error: unknown) => {
    console.error('[backend] knowledge index verification failed:', error);
    reportError(error, { tags: { 'tale.lane': 'boot' } });
  });
  // The PII data tree is a packaging fact, not a tenant one: every role
  // that can enforce a `pii_config` policy (indexing on workers, chat turns
  // on the api) needs it, and a missing tree would otherwise surface only as
  // a per-document warning at the first policy hit. Probe it once here so
  // an image built without it says so at boot. Never fails boot — the
  // gate itself degrades to today's behaviour.
  try {
    PatternRegistry.fromDefaults();
  } catch (error: unknown) {
    console.error(
      '[backend] PII data tree unavailable — pii_config policies cannot be enforced:',
      error,
    );
    reportError(error, { tags: { 'tale.lane': 'boot' } });
  }
  if (env.ROLE !== 'api') {
    await startWorker({
      boss,
      taskList: createTaskList({ sql }),
      concurrency: env.WORKER_CONCURRENCY,
    });
    await registerSchedules(boss);
  }

  // The deployment-default BLOB store. S3 is the only blob backend, so an
  // unseeded deployment refuses every upload; the stack ships a store and
  // this points the default config tree at it. Never fails boot — a store
  // still starting up must not take the API down with it.
  try {
    const store = await ensureDefaultObjectStore();
    if (store.status !== 'present') {
      console.log(`[backend] object store (${store.status}): ${store.detail}`);
    }
  } catch (error: unknown) {
    console.warn('[backend] default object store bootstrap failed:', error);
    reportError(error, { tags: { 'tale.lane': 'boot' } });
  }

  // Loopback-only dev convenience: seed the owner account + workspace so a
  // fresh stack is testable without a manual /setup pass. Gated inside on
  // TALE_DEV_SEED_USER + a loopback SITE_URL; never fails boot.
  if (auth !== null) {
    try {
      const seeded = await seedDevUser({ sql, auth });
      if (seeded.status === 'seeded') {
        console.log(`[backend] dev seed: ${seeded.detail}`);
      }
    } catch (error: unknown) {
      console.warn('[backend] dev seed failed:', error);
    }
  }

  const server =
    env.ROLE === 'worker' || auth === null
      ? null
      : serve(
          { fetch: createApp({ sql, auth }).fetch, port: env.PORT },
          (info) => {
            console.log(
              `[backend] api listening on :${info.port} (role=${env.ROLE})`,
            );
          },
        );

  if (env.ROLE === 'worker') {
    console.log(
      `[backend] worker running (concurrency=${env.WORKER_CONCURRENCY})`,
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[backend] ${signal} received — shutting down`);
    if (server) {
      // Ends the never-ending SSE streams first and force-closes
      // stragglers on a deadline — a bare server.close() waits for every
      // open connection, so one connected browser used to park shutdown
      // here until the orchestrator's SIGKILL, never reaching the graceful
      // boss.stop below and killing in-flight jobs mid-write.
      await closeServerGracefully(server);
    }
    // Graceful: in-flight jobs finish before the instance stops.
    await boss.stop({ graceful: true });
    await sql.end({ timeout: 5 });
    await flushErrorReporting();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(async (error: unknown) => {
  console.error('[backend] fatal startup error:', error);
  reportError(error, { tags: { 'tale.lane': 'boot' } });
  await flushErrorReporting();
  process.exit(1);
});
