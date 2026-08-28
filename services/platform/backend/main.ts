import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { createAuth, type Auth } from './auth/auth.ts';
import { runBootMigrations } from './db/migrate.ts';
import { createSql } from './db/sql.ts';
import { ensureDefaultCorpusSchema } from './domains/knowledge/service.ts';
import { loadEnv } from './env.ts';
import { createBoss, ensureQueues } from './jobs/boss.ts';
import { setEnqueueBoss } from './jobs/enqueue.ts';
import { startWorker } from './jobs/runner.ts';
import { registerSchedules } from './jobs/schedules.ts';
import { createTaskList } from './jobs/task-list.ts';

async function main(): Promise<void> {
  const env = loadEnv();
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

  // pg-boss migrates its own `pgboss` schema on start (advisory-locked).
  // Every role sends jobs, so every role starts an instance; queue
  // maintenance (supervise) runs on workers only.
  const boss = createBoss(env.DATABASE_URL, { supervise: env.ROLE !== 'api' });
  await boss.start();
  await ensureQueues(boss);
  setEnqueueBoss(boss);

  if (env.ROLE !== 'api') {
    await startWorker({
      boss,
      taskList: createTaskList({ sql }),
      concurrency: env.WORKER_CONCURRENCY,
    });
    await registerSchedules(boss);
    // The deployment-default knowledge corpus bootstraps itself; per-org
    // BYO corpora bootstrap on first use inside the pool router.
    await ensureDefaultCorpusSchema().catch((error: unknown) => {
      console.warn('[backend] default corpus bootstrap failed:', error);
    });
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
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    // Graceful: in-flight jobs finish before the instance stops.
    await boss.stop({ graceful: true });
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('[backend] fatal startup error:', error);
  process.exit(1);
});
