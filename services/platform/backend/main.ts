import { setTimeout as sleep } from 'node:timers/promises';

import type { ServerType } from '@hono/node-server';
import { sessionIdleWindowSeconds } from '@tale/shared/utils/session-idle';
import { parseAdditionalSiteUrls } from '@tale/shared/utils/site-urls';

import { PatternRegistry } from '../lib/pii';
import type { Auth } from './auth/auth.ts';
import { settleLiveTurns } from './core/automations/stepper.ts';
import {
  closeKnowledgePools,
  knowledgePoolMax,
  setKnowledgeOutageReporter,
} from './core/knowledge/pool.ts';
import { createBootDatabaseWait } from './db/boot-wait.ts';
import { runBootMigrations } from './db/migrate.ts';
import { createSql } from './db/sql.ts';
import {
  startAuditSealer,
  type AuditSealer,
} from './domains/audit_logs/sealer.ts';
import { releaseOwnedRunLeases } from './domains/automations/store.ts';
import { settleLiveChatTurns } from './domains/chat/live-turns.ts';
import { isBackendDraining } from './domains/control/service.ts';
import { bootDefaultKnowledge } from './domains/knowledge/boot.ts';
import { installCorpusHealthHook } from './domains/knowledge/index-health.ts';
import { ensureDefaultObjectStore } from './domains/object_storage/bootstrap.ts';
import { installReviewHandoverHook } from './domains/tasks/reviews.ts';
import { loadEnv, ownApiUrl } from './env.ts';
import {
  flushErrorReporting,
  initErrorReporting,
  reportError,
  reportKnowledgeDatabaseOutage,
} from './error-reporting.ts';
import { closeServerGracefully } from './http-shutdown.ts';
import {
  alignQueuePolicies,
  bossOptionsForRole,
  startBoss,
} from './jobs/boss.ts';
import { setEnqueueBoss } from './jobs/enqueue.ts';
import { startWorker } from './jobs/runner.ts';
import {
  registerSchedules,
  resumePiiScansAtBoot,
  sweepRunsAtBoot,
} from './jobs/schedules.ts';
import { createTaskList } from './jobs/task-list.ts';
import { configureCodeRunner } from './lib/code-runner.ts';
import { keepJobDirsSwept } from './lib/heavy-slot/job-dir.ts';
import { configureHeavySlot } from './lib/heavy-slot/slot.ts';
import { processShutdown } from './lib/shutdown.ts';
import {
  runShutdownSequence,
  shouldDeferJobs,
  shutdownDrainMs,
} from './shutdown-sequence.ts';
import { backendMetricsResponse, initBackendTelemetry } from './telemetry.ts';

/**
 * What only a process that answers requests needs: the application's routes,
 * the sign-in stack behind them (Better Auth with its OAuth provider,
 * passkeys and database adapter), the HTTP server, and the web tier that
 * serves the built app beside the API (`../server.ts`). A pure worker serves
 * no request, so it never reads them: they are about a third of the modules
 * a boot loads (tale-project/tale#4942, finding 2).
 */
async function loadHttpSurface() {
  const [
    { serve },
    { createApp },
    { configuredMcpResources, seedMcpResources },
    { createAuth },
    { startAuthRequestCache, stopAuthRequestCache },
    { seedDevUser },
    { BACKEND_SERVER_OPTIONS, installClientErrorEnvelope },
    { installVideoProxyRelay },
    { startWebServer, webPort, webTierOff },
    { startModelRelay },
  ] = await Promise.all([
    import('@hono/node-server'),
    import('./app.ts'),
    import('./auth/agent-oauth.ts'),
    import('./auth/auth.ts'),
    import('./auth/request-cache.ts'),
    import('./domains/provisioning/dev-seed.ts'),
    import('./lib/http-hygiene.ts'),
    import('./domains/video_links/proxy-relay.ts'),
    import('../server.ts'),
    import('./domains/llm_relay/start.ts'),
  ]);
  return {
    serve,
    createApp,
    configuredMcpResources,
    seedMcpResources,
    createAuth,
    startAuthRequestCache,
    stopAuthRequestCache,
    seedDevUser,
    BACKEND_SERVER_OPTIONS,
    installClientErrorEnvelope,
    installVideoProxyRelay,
    startWebServer,
    webPort,
    webTierOff,
    startModelRelay,
  };
}

/** Resolves once the listener is bound, and rejects when it cannot be (its
 * port is taken), so that fails the boot like any other step instead of
 * surfacing as an unhandled `error` event. */
function listening(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  // First thing after the env parse, so even a failing boot (migrations, DB
  // connectivity) reports before the process dies. No-op without SENTRY_DSN.
  await initErrorReporting({
    dsn: env.SENTRY_DSN,
    role: env.ROLE,
    tracesSampleRate: env.BACKEND_SENTRY_TRACES_SAMPLE_RATE,
  });
  // A knowledge database that stays unavailable past a routine restart is
  // reported once per outage; the pool router cannot import the reporter
  // itself (`core/knowledge/pool.ts`).
  setKnowledgeOutageReporter(reportKnowledgeDatabaseOutage);
  configureCodeRunner({
    role: env.ROLE,
    processes: env.AUTOMATION_RUNNER_PROCESSES,
  });
  configureHeavySlot({
    slots: env.HEAVY_SLOTS,
    memoryMb: env.HEAVY_SLOT_MEMORY_MB,
  });
  // What a process that was killed mid-job left on this container's disk:
  // looked for now and every few minutes. Not awaited: nothing at boot
  // depends on it.
  keepJobDirsSwept((removed) => {
    console.log(
      `[backend] removed ${removed} job director${removed === 1 ? 'y' : 'ies'} a process left behind`,
    );
  });
  const needsApi = env.ROLE !== 'worker';
  const sql = createSql(env.DATABASE_URL);

  const http = needsApi ? await loadHttpSurface() : null;
  // The app's own port, read before anything is migrated or started: a value
  // that is no port, or the API's, fails this boot at once and by name.
  // `APP_PORT=off` leaves the web tier out and the API serves alone, for a
  // process whose app something else serves: the dev orchestrator's backend,
  // beside the Vite server that holds the app's port.
  const webPort = http === null || http.webTierOff() ? null : http.webPort();
  if (http !== null && webPort === null) {
    console.log('[backend] web tier off (APP_PORT=off): the API serves alone');
  }
  if (webPort === env.PORT) {
    throw new Error(
      `APP_PORT and PORT are both ${env.PORT}: the app and the API each need a port of their own`,
    );
  }
  let auth: Auth | null = null;
  if (http !== null) {
    if (!env.BETTER_AUTH_SECRET) {
      throw new Error(
        `BETTER_AUTH_SECRET is required for role '${env.ROLE}' (only a pure worker boots without it)`,
      );
    }
    auth = http.createAuth({
      databaseUrl: env.DATABASE_URL,
      secret: env.BETTER_AUTH_SECRET,
      baseUrl: env.SITE_URL,
      totpClientName: env.TOTP_CLIENT_NAME,
      totpEnvironment: env.TOTP_ENVIRONMENT,
      additionalOrigins: parseAdditionalSiteUrls(env.ADDITIONAL_SITE_URLS),
      sql,
    });
  }

  // A database that is restarting as this process boots is waited out for
  // up to a minute from its first refusal, not reported, by the steps the
  // boot cannot do without: the migrations, the MCP resources, pg-boss's
  // start and the schedules, on one clock for the whole boot
  // (db/boot-wait.ts). Only an outage past that fails the boot below. The
  // other steps that touch the database do not wait: the best-effort ones
  // (aligning the queue policies, the boot's liveness sweep, the dev seed)
  // log a warning and carry on, and the object-store bootstrap reports what
  // it meets. The knowledge steps wait out the knowledge database on a clock
  // of their own, below.
  const databaseWait = createBootDatabaseWait();

  // App migrations (numbered .sql files and .ts data migrations) run in every
  // role (workers write app tables too); auth-table migrations run wherever
  // auth is configured. The migrator's advisory lock serializes concurrently
  // booting containers.
  await runBootMigrations({
    databaseUrl: env.DATABASE_URL,
    ...(auth ? { authOptions: auth.options } : {}),
    wait: databaseWait,
  });
  if (http !== null) {
    // The MCP endpoint as the sign-in server's resource, on every address
    // the deployment answers on — once the provider's tables exist, and
    // through the boot's wait, like the migrations before it.
    await databaseWait(() =>
      http.seedMcpResources(sql, http.configuredMcpResources()),
    );
  }
  // The additive custody schema exists before this can inventory legacy
  // factors. Refuse an altered/removed active fence before serving requests.
  if (auth !== null)
    await databaseWait(() => auth.initializeSessionAuthority());

  // Metrics collectors need the pool and read app tables, so they register
  // once per process AFTER the schema is known to exist.
  initBackendTelemetry(sql);

  // pg-boss migrates its own `pgboss` schema on start (advisory-locked).
  // Every role sends jobs, so every role starts an instance; queue
  // maintenance (supervise) runs on workers only, and so does the LISTEN
  // connection: a notification wakes workers, and the api role has none.
  const boss = await startBoss(env.DATABASE_URL, {
    ...bossOptionsForRole(env.ROLE),
    wait: databaseWait,
  });
  await alignQueuePolicies(sql);
  setEnqueueBoss(boss);
  // A member's removal hands the reviews that wait on them on, in the same
  // transaction (`auth/membership.ts` cannot import the tasks domain itself).
  installReviewHandoverHook();

  // Per-org BYO corpora bootstrap on first use inside the pool router; the
  // hook verifies (and repairs) their BM25 indexes in that same single flight.
  installCorpusHealthHook(sql);
  // The deployment-default knowledge corpus bootstraps itself on the roles
  // that index, and every role verifies its BM25 indexes BEFORE a job or a
  // request can write to them: a block zeroed by a crash-mode stop makes every
  // chunk insert PANIC the database, and the rebuild is lossless. An advisory
  // lock on the knowledge database leaves the repair to one process; the
  // others skip. Both wait out a knowledge database that is restarting, on a
  // clock of their own (domains/knowledge/boot.ts). Never fails boot — the
  // report is logged, audited, and belled, and an outage past the wait is
  // reported once.
  await bootDefaultKnowledge(sql, { bootstrapSchema: env.ROLE !== 'api' });
  // The PII data tree is a packaging fact, not a tenant one: every role
  // that can enforce a `pii_config` policy (indexing on workers, chat turns
  // on the api) needs it, and a missing tree would otherwise surface only
  // at the first policy hit. Probe it once here so an image built without
  // it says so at boot. Never fails boot — until the tree is back, the
  // indexing gate refuses every document under an enabled policy
  // (`pii_scan_failed`). A worker whose probe loads it queues them again
  // (`resumePiiScansAtBoot`), and so does a save of the policy.
  let piiTreeLoaded = false;
  try {
    PatternRegistry.fromDefaults();
    piiTreeLoaded = true;
  } catch (error: unknown) {
    console.error(
      '[backend] PII data tree unavailable — pii_config policies cannot be enforced:',
      error,
    );
    reportError(error, { tags: { 'tale.lane': 'boot' } });
  }
  let auditSealer: AuditSealer | null = null;
  if (env.ROLE !== 'api') {
    // The corpus pool caps how many indexing jobs commit a slice at once; a
    // worker allowed more concurrent jobs than that queues on it. Said here,
    // where both knobs are set, not as a slow backlog weeks later.
    const corpusPoolMax = knowledgePoolMax();
    if (env.WORKER_CONCURRENCY > corpusPoolMax) {
      console.warn(
        `[backend] WORKER_CONCURRENCY (${env.WORKER_CONCURRENCY}) exceeds KNOWLEDGE_DB_POOL_MAX (${corpusPoolMax}): indexing jobs will queue on the knowledge pool — raise KNOWLEDGE_DB_POOL_MAX alongside it`,
      );
    }
    await startWorker({
      boss,
      taskList: createTaskList({ sql }),
      concurrency: env.WORKER_CONCURRENCY,
      agentStartSlots: env.AGENT_START_SLOTS,
      agentDriveSlots: env.AGENT_DRIVE_SLOTS,
      automationOrgConcurrency: env.AUTOMATION_ORG_CONCURRENCY,
      shouldDefer: shouldDeferJobs(processShutdown, () =>
        isBackendDraining(sql),
      ),
      sql,
    });
    await databaseWait(() => registerSchedules(boss));
    await sweepRunsAtBoot(sql);
    if (piiTreeLoaded) await resumePiiScansAtBoot(sql);
    auditSealer = startAuditSealer(sql);
  }

  // The deployment-default BLOB store. S3 is the only blob backend, so an
  // unconfigured deployment refuses every upload; this brings the default
  // config tree in line with `OBJECT_STORE_*` — the bundled store, or a
  // bucket the operator brings. Never fails boot — a store still starting up
  // must not take the API down with it.
  try {
    const store = await ensureDefaultObjectStore(sql);
    // `present` is the steady state and says nothing new on a healthy
    // restart; every other outcome changed something or explains why it
    // could not, so it belongs in the log.
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
  if (http !== null && auth !== null) {
    try {
      const seeded = await http.seedDevUser({ sql, auth });
      if (seeded.status === 'seeded') {
        console.log(`[backend] dev seed: ${seeded.detail}`);
      }
    } catch (error: unknown) {
      console.warn('[backend] dev seed failed:', error);
    }
  }

  // A process that answers requests keeps the sessions and memberships it
  // resolved for a moment, dropping each the moment the database says it
  // changed (`auth/request-cache.ts`); `AUTH_REQUEST_CACHE=off` turns it off.
  if (http !== null) {
    const cache = http.startAuthRequestCache(sql, {
      sessionConfig: sessionIdleWindowSeconds(),
    });
    if (cache === null) {
      console.log('[backend] auth request cache off (AUTH_REQUEST_CACHE=off)');
    }
  }

  const server =
    http === null || auth === null
      ? null
      : http.serve(
          {
            fetch: http.createApp({ sql, auth }).fetch,
            port: env.PORT,
            ...(env.BACKEND_LISTEN_HOST === undefined
              ? {}
              : { hostname: env.BACKEND_LISTEN_HOST }),
            // The header budget and the response class that keeps a
            // bodiless answer free of content headers — shared with the
            // integration harness (lib/http-hygiene.ts).
            serverOptions: http.BACKEND_SERVER_OPTIONS,
          },
          (info) => {
            console.log(
              `[backend] api listening on :${info.port} (role=${env.ROLE})`,
            );
          },
        );
  // What the listener answers below the app — a body that stops arriving
  // (408), a header block past the budget (431), bytes that are not HTTP
  // (400) — in the JSON envelope the doors speak (lib/http-hygiene.ts).
  if (http !== null && server !== null) http.installClientErrorEnvelope(server);
  // The model relay, on a port of its own where only sandbox sessions reach
  // it: the harnesses' model calls, in place of the sandbox LLM gateway, and
  // a video job's PO-token relay (domains/llm_relay). A container that
  // cannot bind where it must fails its start here.
  const modelRelay =
    http !== null && server !== null
      ? http.startModelRelay({
          sql,
          serve: http.serve,
          env,
          serverOptions: http.BACKEND_SERVER_OPTIONS,
        })
      : null;
  if (modelRelay !== null) await listening(modelRelay);
  // The tunnels a sandbox session's yt-dlp asks the relay's listener for, to
  // one of video ingestion's proxies (domains/video_links/proxy-relay.ts).
  const endVideoProxyRelay =
    http !== null && modelRelay !== null
      ? http.installVideoProxyRelay(modelRelay)
      : null;

  // The web tier, in this process and on a port of its own: the built app,
  // its shell, the status page and the other doors of `../server.ts`. It
  // starts last and writes the ready marker itself, so a replica reads as
  // ready only when it can serve the app and answer what the app then asks.
  // The verdicts it needs from the API (the session oracle, the status
  // probes) it asks of this process's own listener, never of whichever
  // replica a shared network name resolves to; and `/metrics` there answers
  // the one registry this process has.
  const web =
    http === null || server === null || webPort === null
      ? null
      : await listening(server).then(() =>
          http.startWebServer({
            port: webPort,
            ...(env.BACKEND_LISTEN_HOST === undefined
              ? {}
              : { hostname: env.BACKEND_LISTEN_HOST }),
            app: {
              metrics: backendMetricsResponse,
              backendUrl: ownApiUrl(env),
            },
          }),
        );
  web?.markReady();

  if (env.ROLE === 'worker') {
    console.log(
      `[backend] worker running (concurrency=${env.WORKER_CONCURRENCY})`,
    );
  }

  const drainMs = shutdownDrainMs(env);
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    // The app's health answers 503 from here on, and everything keeps
    // working for a moment longer: a balancer that checks each replica
    // needs a check or two before it stops sending this one requests. A
    // replica nothing checks does not wait (`WebServer.drainMs`).
    const webDrainMs = web?.drainMs() ?? 0;
    console.log(
      `[backend] ${signal} received — shutting down (drain ${drainMs} ms${webDrainMs > 0 ? `, after ${webDrainMs} ms for the balancer` : ''})`,
    );
    if (web !== null) {
      web.markShuttingDown();
      await sleep(webDrainMs);
    }
    // The round in flight finishes; what it leaves the next worker seals.
    await auditSealer?.stop();
    await http?.stopAuthRequestCache();
    await runShutdownSequence(signal, {
      role: env.ROLE,
      drainMs,
      shutdown: processShutdown,
      // Ends the never-ending SSE streams first and force-closes
      // stragglers on a deadline — a bare server.close() waits for every
      // open connection, so one connected browser used to park shutdown
      // there until the orchestrator's SIGKILL, never reaching the graceful
      // job stop and killing in-flight jobs mid-write.
      // The web tier's listener closes first: a request it is still
      // answering may ask the API for a verdict.
      closeServer: server
        ? async () => {
            await web?.close();
            // A tunnel is a connection the server neither waits for as a
            // request nor closes when forced: left open, it keeps the close
            // below from ever finishing.
            endVideoProxyRelay?.();
            await Promise.all([
              closeServerGracefully(server),
              ...(modelRelay !== null
                ? [closeServerGracefully(modelRelay)]
                : []),
            ]);
          }
        : null,
      stopBoss: (options) => boss.stop(options),
      settleLiveTurns,
      releaseOwnedRunLeases: () => releaseOwnedRunLeases(sql),
      // A chat reply streams inside the process that took it; one still
      // going when the drain budget ends is settled as interrupted now,
      // not by the sweep ten minutes on (`domains/chat/live-turns.ts`).
      settleChatTurns: (timeoutMs) => settleLiveChatTurns(sql, timeoutMs),
      // The knowledge pools outlive the jobs and requests that used them —
      // drain them here rather than leaving their sockets to process.exit.
      closeStores: async () => {
        await closeKnowledgePools();
        await sql.end({ timeout: 5 });
      },
    });
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
