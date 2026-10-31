/** `burst`: start a burst of agent runs and judge what the host went through. */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { Command, InvalidArgumentError } from 'commander';

import { loadPlanSchema } from '../plan.ts';
import { writeAtomically } from '../runner/report.ts';
import { readState } from '../stack/stack.ts';
import { BurstSetupError, runBurst } from './driver.ts';
import type { BurstReport } from './report.ts';
import { renderBurstMarkdown } from './report.ts';

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

interface BurstFlags {
  plan: string;
  stackState: string;
  target?: string;
  spawnerUrl: string;
  spawner: boolean;
  harness: string;
  agents: number;
  runs: number;
  window: number;
  hogMib: number;
  hogSeconds: number;
  projectSessions?: number;
  pendingGrace: number;
  deadline: number;
  mockMetrics?: string;
  report?: string;
}

/** 0 when every expectation held, 1 when one missed. */
export function burstExitCode(report: BurstReport): 0 | 1 {
  return report.pass ? 0 : 1;
}

async function burstCommand(flags: BurstFlags): Promise<0 | 1 | 2> {
  const plan = loadPlanSchema.parse(
    JSON.parse(await readFile(flags.plan, 'utf8')),
  );
  // A stack `stack up` started names the api to drive and the logs to scan;
  // without one, the plan's target is driven and no log is scanned.
  const stack = existsSync(flags.stackState)
    ? await readState(flags.stackState)
    : null;
  const target = flags.target ?? stack?.apiUrls[0] ?? plan.target;
  const mockMetricsUrl = flags.mockMetrics ?? stack?.mockMetricsUrl ?? null;
  const logFiles =
    stack === null
      ? null
      : stack.processes
          .filter((p) => p.role === 'api' || p.role === 'worker')
          .map((p) => p.log);
  const spawnerToken = process.env.SANDBOX_TOKEN ?? '';
  if (flags.spawner && spawnerToken === '') {
    console.error(
      '[burst] SANDBOX_TOKEN is not set: it signs the spawner admission read (or pass --no-spawner)',
    );
    return 2;
  }
  let report: BurstReport;
  try {
    report = await runBurst({
      plan,
      target,
      spawnerUrl: flags.spawner ? flags.spawnerUrl : null,
      spawnerToken: flags.spawner ? spawnerToken : null,
      harness: flags.harness,
      agents: flags.agents,
      runs: flags.runs,
      windowSeconds: flags.window,
      hogMib: flags.hogMib,
      hogSeconds: flags.hogSeconds,
      projectSessions: flags.projectSessions ?? null,
      pendingGraceSeconds: flags.pendingGrace,
      deadlineSeconds: flags.deadline,
      logFiles,
      mockMetricsUrl,
    });
  } catch (error) {
    if (error instanceof BurstSetupError) {
      console.error(`[burst] setup failed: ${error.message}`);
      return 2;
    }
    throw error;
  }
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const path = flags.report ?? `burst-report-${stamp}.json`;
  const markdown = renderBurstMarkdown(report);
  await writeAtomically(path, `${JSON.stringify(report, null, 2)}\n`);
  await writeAtomically(path.replace(/\.json$/, '') + '.md', markdown);
  console.log(markdown);
  console.log(`[burst] report written to ${path}`);
  return burstExitCode(report);
}

export function createBurstCommand(): Command {
  return new Command('burst')
    .description(
      'Start a burst of agent runs across a project’s agents and judge whether the host held it',
    )
    .requiredOption('--plan <path>', 'plan file written by `seed`')
    .option(
      '--stack-state <path>',
      'state file of `stack up`: its first api is the target, its api and worker logs are scanned, its mock counts the hogs',
      '.tale-load-stack.json',
    )
    .option(
      '--target <url>',
      'the api to drive (default: the stack’s first api, else the plan target)',
    )
    .option(
      '--spawner-url <url>',
      'the spawner whose admission answer is sampled; env SANDBOX_TOKEN signs the read',
      'http://127.0.0.1:8003',
    )
    .option('--no-spawner', 'do not sample the spawner’s admission answer')
    .option('--harness <name>', 'harness of the burst’s agents', 'claude-code')
    .option('--agents <n>', 'agents the runs spread over', positiveInteger, 7)
    .option('--runs <n>', 'runs to start', positiveInteger, 12)
    .option(
      '--window <seconds>',
      'seconds over which the runs start',
      nonNegative,
      30,
    )
    .option(
      '--hog-mib <n>',
      'memory each run’s turn holds, in MiB',
      positiveInteger,
      2048,
    )
    .option(
      '--hog-seconds <n>',
      'seconds each run’s turn holds it and keeps a CPU busy',
      positiveInteger,
      60,
    )
    .option(
      '--project-sessions <n>',
      'the project’s sandbox budget to set (default: the deployment’s room but one session for each other kind)',
      positiveInteger,
    )
    .option(
      '--pending-grace <seconds>',
      'longest a run may wait without saying why',
      nonNegative,
      60,
    )
    .option(
      '--deadline <seconds>',
      'give up on runs still open after this long',
      positiveInteger,
      1_800,
    )
    .option(
      '--mock-metrics <url>',
      'the mock provider’s /metrics, whose hog counts show each turn held its memory (default: the stack’s mock)',
    )
    .option(
      '--report <path>',
      'report path (.json; a .md is written beside it)',
    )
    .action(async (flags: BurstFlags) => {
      try {
        process.exitCode = await burstCommand(flags);
      } catch (error) {
        console.error('[burst] failed:', error);
        process.exitCode = 2;
      }
    });
}
