/**
 * `runSeed(options)`: build the population a load run drives and write the
 * plan file describing it.
 *
 * Order of work:
 *
 *  1. identities — SQL mode (`dbUrl`): users, credential accounts and, with
 *     `authSecret`, one minted session per user, as bulk INSERTs sharing one
 *     scrypt hash; the deployment must then accept user 0's minted session
 *     before anything else runs. HTTP mode (no `dbUrl`): every user signs up
 *     over the API.
 *  2. organizations — over the API, as their owners (minted cookie, else a
 *     password sign-in): create, wait for the scaffold job, then wire the
 *     mock provider, its env credential, the embedding model and one shared
 *     project, and record the chat model the composer offers.
 *  3. memberships — SQL: block members with weighted roles plus the mega
 *     organization, then each user's active organization. HTTP: the owners
 *     add their members through `/api/app/members`.
 *  4. the plan — validated with `loadPlanSchema`, written atomically. It is
 *     also checkpointed while organizations are configured, so an
 *     interrupted seed resumes (`--resume`) with the same run id and
 *     password and skips every organization the plan already lists; the
 *     identity tables are skipped when their counts are complete, and every
 *     write is keyed by a deterministic id, so nothing is written twice.
 *
 * Command line (`node tools/load/src/seed/cli.ts --help`). Secrets are read
 * from the environment so they never show in a process listing:
 *
 *   TALE_LOAD_DB_URL=postgres://tale:…@127.0.0.1:5452/tale_app \
 *   TALE_LOAD_AUTH_SECRET=<the deployment's BETTER_AUTH_SECRET> \
 *     node tools/load/src/seed/cli.ts --target http://127.0.0.1:4105 \
 *       --users 300 --org-size 50 --mega-org-size 100 --output plan.json
 *
 *   --target <url>              base URL of the deployment (required)
 *   --users <n>                 virtual users (required)
 *   --org-size <n>              users per block organization (required); a
 *                               partial last block is one more organization
 *   --mega-org-size <n>         users [0, n) also join one large organization
 *                               owned by user 0 (default 0: none)
 *   --db-url <url>              app database; absent, the whole seed runs over
 *                               HTTP (env TALE_LOAD_DB_URL)
 *   --auth-secret <secret>      BETTER_AUTH_SECRET; with --db-url, one session
 *                               per user is minted (env TALE_LOAD_AUTH_SECRET)
 *   --output <file>             plan file (default load-plan.json); an existing
 *                               one is never overwritten without --resume
 *   --resume                    continue the plan at --output: same run id and
 *                               password, listed organizations skipped
 *   --run-id <id>               4–16 lower-case alphanumerics (default random)
 *   --password <password>       every user's password, ≥ 12 characters with
 *                               upper, lower, digit and special (default
 *                               generated; env TALE_LOAD_PASSWORD)
 *   --email-domain <domain>     e-mail domain (default load.tale.invalid)
 *   --origin <url>              Origin header on writes (default: the target)
 *   --provider-slug <slug>      mock provider slug (default loadmock)
 *   --provider-base-url <url>   mock base URL (default http://127.0.0.1:4199/v1)
 *   --provider-env-name <name>  the env credential's variable (default
 *                               TALE_PROVIDER_KEY_LOADMOCK)
 *   --provider-api-format <f>   openai | anthropic (default openai)
 *   --chat-model <id>           preferred chat model (default load-chat-fast)
 *   --embedding-model <id>      embedding model (default load-embed)
 *   --embedding-dimensions <n>  a knowledge vector width (default 1536)
 *   --catalog-source <s>        models-endpoint (the platform lists the mock's
 *                               /models; default) | none (the credential's
 *                               allowlist is the catalog: no mock needed)
 *   --concurrency <n>           HTTP requests in flight (default 16)
 *   --batch-size <n>            rows per INSERT (default 2000, max 5000)
 *   --sql-parallelism <n>       SQL batches in flight (default 4)
 *   --forwarded-for-base <ip>   synthetic X-Forwarded-For prefix for password
 *                               sign-ins (`10.77`), spreading the per-IP limit
 *   --scaffold-timeout-ms <ms>  per-organization scaffold wait (default 120000)
 *
 * The exit code is 1 when any organization, user or membership failed; the
 * summary on stderr names each. The backend must run with
 * TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 when the mock listens on a private
 * address, and must define the credential's env variable for chat turns to
 * reach the mock (seeding itself does not need it). A deployment that limits
 * who may create organizations (TALE_ORGANIZATION_CREATORS) refuses the
 * seeded owners.
 *
 * What to expect, measured on one laptop against a single backend process
 * (TALE_ROLE=all) and a local Postgres: the SQL identity pass writes ~23,000
 * users per second (users, accounts and sessions together), memberships and
 * active organizations ~60,000 users per second, and organizations are
 * created at ~200 per second but CONFIGURED at ~16 per second, bounded by
 * the platform's `org.scaffold` job. 20,000 users in organizations of 100
 * took 15 s end to end; a million users in organizations of 100 is
 * therefore dominated by its 10,000 organizations (~10 minutes at the
 * default concurrency). A resume of a complete plan writes nothing.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import {
  loadPlanSchema,
  type LoadPlan,
  type PlanOrganization,
} from '../plan.ts';
import {
  assertMintedSessionAccepted,
  knownCookieAuth,
  mintedAuth,
  passwordAuth,
  type UserAuth,
} from './auth.ts';
import { createProgress } from './concurrency.ts';
import { openDatabase } from './db.ts';
import { addMembersOverHttp, signUpUsers } from './http-identities.ts';
import { SeedHttp } from './http.ts';
import {
  seedIdentities,
  seedMemberships,
  setActiveOrganizations,
} from './identities.ts';
import {
  parseSeedOptions,
  resolveRunIdentity,
  type SeedOptions,
  type SeedOptionsInput,
  type SeedProvider,
} from './options.ts';
import {
  configureOrganizations,
  createOrganizations,
  type OrganizationIssue,
  type OrgSeedContext,
} from './organizations.ts';
import {
  organizationIndexes,
  populationFor,
  type PopulationPlan,
} from './population.ts';

// ---------------------------------------------------------------------------
// The plan file
// ---------------------------------------------------------------------------

/** The plan for a population, its configured organizations and provider. */
export function buildPlan(args: {
  population: PopulationPlan;
  target: string;
  provider: SeedProvider;
  organizations: readonly PlanOrganization[];
  createdAt: Date;
}): LoadPlan {
  const { population, provider } = args;
  return loadPlanSchema.parse({
    version: 1,
    createdAt: args.createdAt.toISOString(),
    target: args.target,
    runId: population.runId,
    users: population.users,
    organizations: {
      count: population.organizations.count,
      size: population.organizations.size,
      megaOrgSize: population.organizations.megaOrgSize,
      list: [...args.organizations].sort((a, b) => a.index - b.index),
    },
    provider: {
      slug: provider.slug,
      baseUrl: provider.baseUrl,
      envName: provider.envName,
      apiFormat: provider.apiFormat,
      chatModel: provider.chatModel,
      embeddingModel: provider.embeddingModel,
      embeddingDimensions: provider.embeddingDimensions,
    },
  });
}

/** Write `plan` to `file` via a temp file and a rename: never half-written. */
export async function writePlanAtomic(
  file: string,
  plan: LoadPlan,
): Promise<void> {
  const validated = loadPlanSchema.parse(plan);
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/** Read and validate a plan file. */
export async function readPlan(file: string): Promise<LoadPlan> {
  return loadPlanSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

/** A resumed plan must describe the same population the options do. */
function assertResumable(plan: LoadPlan, options: SeedOptions): void {
  const mismatches: string[] = [];
  if (plan.users.count !== options.users) mismatches.push('users');
  if (plan.organizations.size !== options.orgSize) mismatches.push('orgSize');
  if (plan.organizations.megaOrgSize !== options.megaOrgSize) {
    mismatches.push('megaOrgSize');
  }
  if (plan.users.emailDomain !== options.emailDomain)
    mismatches.push('emailDomain');
  if (mismatches.length > 0) {
    throw new Error(
      `Cannot resume ${options.output}: it describes a different population (${mismatches.join(', ')})`,
    );
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface SeedReport {
  plan: LoadPlan;
  mode: 'sql' | 'http';
  sessionsMinted: boolean;
  organizations: {
    expected: number;
    resumed: number;
    created: number;
    configured: number;
  };
  /** Per-organization and per-user failures; empty on a clean seed. */
  failures: string[];
  /** Things that worked but deserve a look (a scaffold that failed, …). */
  warnings: string[];
  /** Milliseconds per phase. */
  timings: Record<string, number>;
}

const issueLine = (issue: OrganizationIssue): string =>
  `org ${issue.index} (${issue.slug}) — ${issue.step}: ${issue.message}`;

/** Serialised, throttled plan checkpoints while organizations complete. */
function checkpointer(
  file: string,
  build: () => LoadPlan,
  log: (line: string) => void,
): { request(): void; flush(): Promise<void> } {
  let chain = Promise.resolve();
  let last = 0;
  const write = (): void => {
    chain = chain
      .then(() => writePlanAtomic(file, build()))
      .catch((error: unknown) => {
        log(
          `[seed] checkpoint of ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };
  return {
    request() {
      const now = Date.now();
      if (now - last < 5000) return;
      last = now;
      write();
    },
    async flush() {
      write();
      await chain;
    },
  };
}

/** {@link runSeed} with the full report (the CLI's exit code reads it). */
export async function runSeedWithReport(
  input: SeedOptionsInput,
  deps: { log?: (line: string) => void } = {},
): Promise<SeedReport> {
  const log = deps.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const options = parseSeedOptions(input);
  const started = performance.now();
  const timings: Record<string, number> = {};
  const failures: string[] = [];
  const warnings: string[] = [];

  // Resume or start fresh: an existing plan is never overwritten silently.
  let resumed: LoadPlan | null = null;
  if (existsSync(options.output)) {
    if (!options.resume) {
      throw new Error(
        `${options.output} already exists: resume it (--resume) or choose another output`,
      );
    }
    resumed = await readPlan(options.output);
    assertResumable(resumed, options);
    log(
      `[seed] resuming run ${resumed.runId}: ${resumed.organizations.list.length} organization(s) already in the plan`,
    );
  } else if (options.resume) {
    log(`[seed] nothing to resume at ${options.output}; starting a new run`);
  }
  const identity = resolveRunIdentity(
    options,
    resumed ? { runId: resumed.runId, password: resumed.users.password } : null,
  );
  if (options.authSecret !== undefined && options.dbUrl === undefined) {
    warnings.push('authSecret ignored: minting sessions needs dbUrl as well');
  }
  const mode = options.dbUrl === undefined ? 'http' : 'sql';
  const sessionsMinted = mode === 'sql' && options.authSecret !== undefined;
  const population = populationFor({
    runId: identity.runId,
    emailDomain: options.emailDomain,
    password: identity.password,
    sessionsMinted,
    users: options.users,
    orgSize: options.orgSize,
    megaOrgSize: options.megaOrgSize,
  });
  const siteUrl = options.origin ?? options.target;
  const done = new Map<number, PlanOrganization>(
    (resumed?.organizations.list ?? []).map((org) => [org.index, org]),
  );
  const planNow = (): LoadPlan =>
    buildPlan({
      population,
      target: options.target,
      provider: options.provider,
      organizations: [...done.values()],
      createdAt: new Date(),
    });
  const checkpoint = checkpointer(options.output, planNow, log);
  const http = new SeedHttp({
    target: options.target,
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    connections: options.concurrency + 4,
  });
  // Refuse an unreachable target before anything lands on disk.
  try {
    const ready = await http.send({ method: 'GET', path: '/api/health/ready' });
    if (ready.status !== 200) {
      throw new Error(
        `${options.target} is not ready (health answered ${ready.status})`,
      );
    }
  } catch (error) {
    await http.close();
    throw error;
  }
  // The run id and password are on disk before any row is written, so even
  // a seed killed during the identity pass can be resumed.
  await writePlanAtomic(options.output, planNow());
  log(
    `[seed] run ${identity.runId}: ${options.users} users, ${population.organizations.count} block org(s) of ${options.orgSize}` +
      `${options.megaOrgSize > 0 ? ` + a mega org of ${options.megaOrgSize}` : ''}; mode ${mode}${sessionsMinted ? ' with minted sessions' : ''}`,
  );

  const sql: Sql | null =
    options.dbUrl === undefined
      ? null
      : openDatabase(options.dbUrl, options.sqlParallelism);
  const sqlCtx =
    sql === null
      ? null
      : {
          sql,
          plan: population,
          batchSize: options.batchSize,
          parallelism: options.sqlParallelism,
          log,
        };
  try {
    // 1. Identities.
    let phase = performance.now();
    let auth: UserAuth;
    let userIds: Map<number, string> | null = null;
    if (sqlCtx !== null) {
      const result = await seedIdentities(
        sqlCtx,
        identity.password,
        options.authSecret ?? null,
      );
      log(
        `[seed] identities: +${result.usersInserted} users, +${result.accountsInserted} accounts, +${result.sessionsInserted} sessions` +
          `${result.skipped.length > 0 ? ` (already complete: ${result.skipped.join(', ')})` : ''}`,
      );
      if (sessionsMinted && options.authSecret !== undefined) {
        await assertMintedSessionAccepted(
          http,
          siteUrl,
          options.authSecret,
          population,
          0,
        );
        auth = mintedAuth(siteUrl, options.authSecret, identity.runId);
      } else {
        auth = passwordAuth(http, population, options.forwardedForBase);
      }
    } else {
      const result = await signUpUsers(http, population, {
        concurrency: options.concurrency,
        ...(options.forwardedForBase === undefined
          ? {}
          : { forwardedForBase: options.forwardedForBase }),
        log,
      });
      for (const failure of result.failures) {
        failures.push(`user ${failure.index} — sign-up: ${failure.message}`);
      }
      userIds = result.userIds;
      auth = knownCookieAuth(
        result.ownerCookies,
        passwordAuth(http, population, options.forwardedForBase),
      );
    }
    timings.identities = performance.now() - phase;

    // 2. Organizations.
    phase = performance.now();
    const pending = organizationIndexes(population).filter(
      (index) => !done.has(index),
    );
    const orgCtx: OrgSeedContext = {
      http,
      sql,
      plan: population,
      provider: options.provider,
      auth,
      concurrency: options.concurrency,
      scaffoldTimeoutMs: options.scaffoldTimeoutMs,
      log,
    };
    const createProgressLine = createProgress(
      'organizations created',
      pending.length,
      {
        write: log,
      },
    );
    const created = await createOrganizations(orgCtx, pending, () =>
      createProgressLine.tick(),
    );
    createProgressLine.done();
    timings.createOrganizations = performance.now() - phase;
    failures.push(...created.failures.map(issueLine));

    phase = performance.now();
    const configureProgress = createProgress(
      'organizations configured',
      created.created.length,
      { write: log },
    );
    const configured = await configureOrganizations(
      orgCtx,
      created.created,
      (org) => {
        done.set(org.index, org);
        configureProgress.tick();
        checkpoint.request();
      },
    );
    configureProgress.done();
    await checkpoint.flush();
    timings.configureOrganizations = performance.now() - phase;
    failures.push(...configured.failures.map(issueLine));
    warnings.push(...configured.warnings.map(issueLine));

    // Memberships follow every organization that EXISTS, configured or not:
    // a configuration failure is retried by a resume, the members need not be.
    const orgIds = new Map<number, string>();
    for (const org of created.created) orgIds.set(org.index, org.id);
    for (const org of done.values()) orgIds.set(org.index, org.id);

    // 3. Memberships and active organizations.
    phase = performance.now();
    if (sqlCtx !== null) {
      const members = await seedMemberships(sqlCtx, orgIds);
      if (members.skipped > 0) {
        failures.push(
          `${members.skipped} membership(s) skipped: their organization was not created`,
        );
      }
      log(`[seed] memberships: +${members.inserted}`);
      const active = await setActiveOrganizations(
        sqlCtx,
        orgIds,
        sessionsMinted,
      );
      log(
        `[seed] active organizations: ${active.users} user(s), ${active.sessions} session(s) updated`,
      );
    } else if (userIds !== null) {
      const members = await addMembersOverHttp(
        http,
        population,
        { orgIds, userIds },
        auth,
        { concurrency: options.concurrency, log },
      );
      log(
        `[seed] memberships: +${members.added} (${members.existing} existing, ${members.skipped} skipped)`,
      );
      if (members.skipped > 0) {
        failures.push(
          `${members.skipped} membership(s) skipped: their organization or user is missing`,
        );
      }
      failures.push(
        ...members.failures.map(
          (f) => `user ${f.index} — membership: ${f.message}`,
        ),
      );
    }
    timings.memberships = performance.now() - phase;

    // 4. The plan.
    const plan = planNow();
    await writePlanAtomic(options.output, plan);
    timings.total = performance.now() - started;
    const report: SeedReport = {
      plan,
      mode,
      sessionsMinted,
      organizations: {
        expected: organizationIndexes(population).length,
        resumed: resumed?.organizations.list.length ?? 0,
        created: created.created.length,
        configured: configured.configured.length,
      },
      failures,
      warnings,
      timings,
    };
    printSummary(report, options.output, log);
    return report;
  } finally {
    await http.close();
    if (sql !== null) await sql.end({ timeout: 5 });
  }
}

/** Seed and return the plan; see the module comment. */
export async function runSeed(
  input: SeedOptionsInput,
  deps: { log?: (line: string) => void } = {},
): Promise<LoadPlan> {
  return (await runSeedWithReport(input, deps)).plan;
}

const seconds = (ms: number | undefined): string =>
  ms === undefined ? '-' : `${(ms / 1000).toFixed(1)} s`;

function printSummary(
  report: SeedReport,
  output: string,
  log: (line: string) => void,
): void {
  const { plan, organizations } = report;
  const withModel = plan.organizations.list.filter(
    (org) => org.modelId !== null,
  ).length;
  log('[seed] ---- summary ----');
  log(`[seed] plan          ${output} (run ${plan.runId})`);
  log(
    `[seed] users         ${plan.users.count} (${report.mode} mode, sessions ${report.sessionsMinted ? 'minted' : 'not minted'})`,
  );
  log(
    `[seed] organizations ${plan.organizations.list.length}/${organizations.expected} in the plan` +
      ` (${organizations.resumed} resumed, ${organizations.created} created/adopted, ${organizations.configured} configured, ${withModel} with a chat model)`,
  );
  log(
    `[seed] elapsed       ${seconds(report.timings.total)} (identities ${seconds(report.timings.identities)},` +
      ` create ${seconds(report.timings.createOrganizations)}, configure ${seconds(report.timings.configureOrganizations)},` +
      ` memberships ${seconds(report.timings.memberships)})`,
  );
  log(`[seed] warnings      ${report.warnings.length}`);
  for (const line of report.warnings.slice(0, 10)) log(`[seed]   ${line}`);
  if (report.warnings.length > 10)
    log(`[seed]   … ${report.warnings.length - 10} more`);
  log(`[seed] failures      ${report.failures.length}`);
  for (const line of report.failures.slice(0, 20)) log(`[seed]   ${line}`);
  if (report.failures.length > 20)
    log(`[seed]   … ${report.failures.length - 20} more`);
}
