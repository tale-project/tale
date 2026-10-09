/**
 * `run` and `merge` as commands.
 *
 * `run` drives one shard of a plan with one profile and writes a JSON
 * report plus its Markdown rendering; its exit code is the verdict (0 every
 * threshold held, 1 one failed, 2 the harness itself failed). `merge` folds
 * the reports of a distributed run's shards into one, with the same
 * verdict.
 */

import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Command, InvalidArgumentError, Option } from 'commander';

import { thresholdsSchema } from '../metrics/index.ts';
import { loadPlanSchema } from '../plan.ts';
import {
  DEFAULT_PERSONA_WEIGHTS,
  PERSONA_NAMES,
  type PersonaWeights,
  personaWeightsSchema,
  scenarioOptionsSchema,
} from '../scenario/contract.ts';
import { runLoad } from './orchestrator.ts';
import { PROFILE_NAMES, type ProfileName, buildProfile } from './profiles.ts';
import {
  buildReport,
  DEFAULT_THRESHOLDS,
  mergeReports,
  readReport,
  renderMarkdown,
  type RunReport,
  writeAtomically,
} from './report.ts';

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('expected a positive integer');
  }
  return parsed;
}

function nonNegative(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError('expected a non-negative number');
  }
  return parsed;
}

function share(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError('expected a number between 0 and 1');
  }
  return parsed;
}

/** `2/8` → shard 2 of 8 (0-based index). */
function parseShard(value: string): { index: number; count: number } {
  const match = /^(\d+)\/(\d+)$/.exec(value.trim());
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (match === null || count < 1 || index < 0 || index >= count) {
    throw new InvalidArgumentError('expected <index>/<count>, e.g. 0/4');
  }
  return { index, count };
}

/** `browser=40,chatter=30` (or a JSON object) → persona weights. */
function parsePersonas(value: string): PersonaWeights {
  const trimmed = value.trim();
  const raw: unknown = trimmed.startsWith('{')
    ? JSON.parse(trimmed)
    : Object.fromEntries(
        trimmed.split(',').map((pair) => {
          const [name = '', weight = ''] = pair.split('=');
          return [name.trim(), Number(weight)];
        }),
      );
  const parsed = personaWeightsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidArgumentError(
      `expected persona=weight pairs over ${PERSONA_NAMES.join(', ')}`,
    );
  }
  return parsed.data;
}

function list(value: string, previous: string[] = []): string[] {
  return [
    ...previous,
    ...value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  ];
}

interface RunFlags {
  plan: string;
  profile: ProfileName;
  users?: number;
  ramp: number;
  hold: number;
  steps: number;
  target: string[];
  authSecret?: string;
  shard: { index: number; count: number };
  processes?: number;
  personas?: PersonaWeights;
  thinkScale?: number;
  realtime: boolean;
  threadStreams: boolean;
  chat: boolean;
  uploads: boolean;
  knowledgeSearch: boolean;
  passwordSignInRate?: number;
  providerFaultRate?: number;
  sessionSeconds?: number;
  forwardedFor: boolean;
  seed: number;
  thresholds?: string;
  metrics: string[];
  metricsBearer?: string;
  dbUrl?: string;
  appDatabase: string;
  report?: string;
  breakpointP95: number;
  breakpointErrorRate: number;
  progressSeconds: number;
  scenarioModule?: string;
  localAddress: string[];
}

async function runCommand(flags: RunFlags): Promise<number> {
  const plan = loadPlanSchema.parse(
    JSON.parse(await readFile(flags.plan, 'utf8')),
  );
  const shardUsers = Math.ceil(plan.users.count / flags.shard.count);
  const peakUsers = Math.min(flags.users ?? shardUsers, shardUsers);
  const profile = buildProfile({
    profile: flags.profile,
    users: peakUsers,
    rampSeconds: flags.ramp,
    holdSeconds: flags.hold,
    steps: flags.steps,
  });
  const scenario = scenarioOptionsSchema.parse({
    ...profile.scenario,
    ...(flags.thinkScale === undefined
      ? {}
      : { thinkTimeScale: flags.thinkScale }),
    ...(flags.realtime ? {} : { realtime: false }),
    ...(flags.threadStreams ? {} : { threadStreams: false }),
    ...(flags.chat ? {} : { chat: false }),
    ...(flags.uploads ? {} : { uploads: false }),
    ...(flags.knowledgeSearch ? {} : { knowledgeSearch: false }),
    ...(flags.passwordSignInRate === undefined
      ? {}
      : { passwordSignInRate: flags.passwordSignInRate }),
    ...(flags.providerFaultRate === undefined
      ? {}
      : { providerFaultRate: flags.providerFaultRate }),
    ...(flags.sessionSeconds === undefined
      ? {}
      : { sessionSeconds: flags.sessionSeconds }),
  });
  const authSecret =
    flags.authSecret ?? process.env.TALE_LOAD_AUTH_SECRET ?? null;
  if (plan.users.sessionsMinted && authSecret === null) {
    console.warn(
      '[load] the plan minted sessions but no auth secret was given: every user signs in with the password (rate limited per client address)',
    );
  }
  let thresholdSpec: Record<string, string | string[]> = DEFAULT_THRESHOLDS;
  if (flags.thresholds !== undefined) {
    thresholdSpec = thresholdsSchema.parse(
      JSON.parse(await readFile(flags.thresholds, 'utf8')),
    );
  } else if (!scenario.chat) {
    // Chat is off: a turn threshold would fail for want of samples.
    thresholdSpec = Object.fromEntries(
      Object.entries(DEFAULT_THRESHOLDS).filter(
        ([key]) => !key.startsWith('chat.'),
      ),
    );
  }
  const targets = flags.target.length > 0 ? flags.target : [plan.target];
  const processes =
    flags.processes ?? Math.max(1, Math.min(availableParallelism() - 1, 8));
  const metricsBearer =
    flags.metricsBearer ?? process.env.TALE_LOAD_METRICS_BEARER ?? undefined;
  const dbUrl = flags.dbUrl ?? process.env.TALE_LOAD_STATS_DB_URL ?? undefined;
  console.log(
    `[load] ${profile.name}: up to ${peakUsers.toLocaleString('en-US')} users of shard ${flags.shard.index}/${flags.shard.count} on ${processes} processes → ${targets.join(', ')}`,
  );

  const outcome = await runLoad({
    plan,
    profile,
    baseUrls: targets,
    authSecret,
    personas: flags.personas ?? profile.personas ?? DEFAULT_PERSONA_WEIGHTS,
    scenario,
    forwardedFor: flags.forwardedFor,
    seed: flags.seed,
    shard: flags.shard,
    processes,
    scenarioModule:
      flags.scenarioModule ??
      fileURLToPath(new URL('../scenario/index.ts', import.meta.url)),
    localAddresses: flags.localAddress,
    progressSeconds: flags.progressSeconds,
    metricsEndpoints: flags.metrics.map((url) => ({
      url,
      ...(metricsBearer === undefined ? {} : { bearer: metricsBearer }),
    })),
    database:
      dbUrl === undefined
        ? null
        : { url: dbUrl, appDatabase: flags.appDatabase },
    breakpoint: {
      p95Ms: flags.breakpointP95,
      errorRate: flags.breakpointErrorRate,
    },
    onProgress: (line) => console.log(`[load] ${line}`),
  });

  const report = buildReport({
    outcome,
    profile: profile.name,
    peakUsers,
    planRunId: plan.runId,
    targets,
    shard: flags.shard,
    processes,
    thresholdSpec,
  });
  const stamp = new Date(outcome.startedAt).toISOString().replace(/[:.]/g, '-');
  const path =
    flags.report ??
    `load-report-${profile.name}-${flags.shard.index}of${flags.shard.count}-${stamp}.json`;
  const markdown = renderMarkdown(report);
  await writeAtomically(path, `${JSON.stringify(report, null, 2)}\n`);
  await writeAtomically(path.replace(/\.json$/, '') + '.md', markdown);
  console.log(markdown);
  console.log(`[load] report written to ${path}`);
  return exitCodeOf(report);
}

/**
 * 0 when every threshold held, 1 when one failed, 2 when the harness itself
 * did not run as asked (a worker crashed, failed or had to be killed) — a
 * verdict on generators that did not run is not a verdict on the target.
 */
export function exitCodeOf(report: RunReport): 0 | 1 | 2 {
  if (report.outcome.workerFailures.length > 0) return 2;
  return report.passed ? 0 : 1;
}

export function createRunCommand(): Command {
  return new Command('run')
    .description(
      'Drive one shard of a plan with a load profile and write a report',
    )
    .requiredOption('--plan <path>', 'plan file written by `seed`')
    .addOption(
      new Option('--profile <name>', 'load profile')
        .choices(PROFILE_NAMES)
        .default('load'),
    )
    .option(
      '--users <n>',
      'peak concurrent users of this shard',
      positiveInteger,
    )
    .option('--ramp <seconds>', 'seconds to reach the peak', nonNegative, 120)
    .option(
      '--hold <seconds>',
      'seconds to hold the peak (each stress step)',
      nonNegative,
      600,
    )
    .option('--steps <n>', 'steps of a stress run', positiveInteger, 5)
    .option(
      '--target <url>',
      'entry point(s); repeat or comma-separate (default: the plan target)',
      list,
      [],
    )
    .option(
      '--auth-secret <secret>',
      'deployment auth secret to adopt minted sessions (env TALE_LOAD_AUTH_SECRET)',
    )
    .addOption(
      new Option('--shard <i/n>', 'this generator’s shard of the plan')
        .argParser(parseShard)
        .default({ index: 0, count: 1 }, '0/1'),
    )
    .option(
      '--processes <n>',
      'generator processes (default: cores - 1, at most 8)',
      positiveInteger,
    )
    .option(
      '--personas <mix>',
      'persona weights, e.g. browser=40,chatter=30',
      parsePersonas,
    )
    .option('--think-scale <factor>', 'multiply every think time', nonNegative)
    .option('--no-realtime', 'do not hold the /events hint stream')
    .option('--no-thread-streams', 'do not hold per-thread chat streams')
    .option('--no-chat', 'send no chat turns')
    .option('--no-uploads', 'upload no documents')
    .option('--no-knowledge-search', 'run no knowledge searches')
    .option(
      '--password-sign-in-rate <share>',
      'share of sessions that sign in with the password',
      share,
    )
    .option(
      '--provider-fault-rate <share>',
      'share of chat messages carrying a mock fault directive',
      share,
    )
    .option(
      '--session-seconds <s>',
      'mean session length before a user comes back fresh (0: never)',
      nonNegative,
    )
    .option(
      '--forwarded-for',
      'send a per-user benchmark address as X-Forwarded-For',
      false,
    )
    .option('--seed <n>', 'seed of every per-user choice', positiveInteger, 1)
    .option(
      '--thresholds <path>',
      'thresholds JSON (default: built-in service levels)',
    )
    .option(
      '--metrics <url>',
      'Prometheus endpoint(s) to read before and after; repeat or comma-separate',
      list,
      [],
    )
    .option(
      '--metrics-bearer <token>',
      'bearer for the metrics endpoints (env TALE_LOAD_METRICS_BEARER)',
    )
    .option(
      '--db-url <url>',
      'database holding pg_stat_statements (env TALE_LOAD_STATS_DB_URL)',
    )
    .option(
      '--app-database <name>',
      'the platform’s app database name',
      'tale_app',
    )
    .option(
      '--report <path>',
      'report path (.json; a .md is written beside it)',
    )
    .option(
      '--breakpoint-p95 <ms>',
      'a stress stage breaks above this p95',
      nonNegative,
      2_000,
    )
    .option(
      '--breakpoint-error-rate <share>',
      'a stress stage breaks above this error share',
      share,
      0.02,
    )
    .option(
      '--progress-seconds <s>',
      'seconds between progress lines',
      positiveInteger,
      5,
    )
    .option(
      '--local-address <ip>',
      'source address(es) for outgoing connections, to go past one address’s ephemeral ports; repeat or comma-separate',
      list,
      [],
    )
    .option(
      '--scenario-module <path>',
      'a module exporting runVirtualUser to drive instead of the built-in scenario',
    )
    .action(async (flags: RunFlags) => {
      try {
        process.exitCode = await runCommand(flags);
      } catch (error) {
        console.error('[load] run failed:', error);
        process.exitCode = 2;
      }
    });
}

export function createMergeCommand(): Command {
  return new Command('merge')
    .description('Fold the reports of a distributed run into one')
    .argument('<reports...>', 'report JSON files, one per shard')
    .requiredOption(
      '--out <path>',
      'merged report path (.json; a .md is written beside it)',
    )
    .option(
      '--thresholds <path>',
      'thresholds JSON (default: the first report’s)',
    )
    .action(
      async (paths: string[], flags: { out: string; thresholds?: string }) => {
        try {
          const reports = await Promise.all(
            paths.map((path) => readReport(path)),
          );
          const spec =
            flags.thresholds === undefined
              ? undefined
              : thresholdsSchema.parse(
                  JSON.parse(await readFile(flags.thresholds, 'utf8')),
                );
          const merged = mergeReports(reports, spec);
          const markdown = renderMarkdown(merged);
          await writeAtomically(
            flags.out,
            `${JSON.stringify(merged, null, 2)}\n`,
          );
          await writeAtomically(
            flags.out.replace(/\.json$/, '') + '.md',
            markdown,
          );
          console.log(markdown);
          process.exitCode = exitCodeOf(merged);
        } catch (error) {
          console.error('[load] merge failed:', error);
          process.exitCode = 2;
        }
      },
    );
}
