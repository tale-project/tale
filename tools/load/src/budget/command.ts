/**
 * `budget`: read a `tale deploy` deployment's memory under the reference
 * workload and judge it against the 500 MB budget of tale#4942.
 *
 * The run: refuse an engine the reading does not hold on (cgroup v1, a
 * rootless engine, the `none` cgroup driver), set the workload up (the
 * people who chat sign in, the standard agent is pinned to pi, the
 * reference files are made), start the sampler, read the deployment at rest
 * for `--settle` seconds, run the workload, run `--flip-command` (a
 * blue/green flip) while it reads, read on for `--tail` seconds, stop. It
 * writes the JSON report, its Markdown rendering and the readings as CSV,
 * and exits 0 within the budget, 1 when the budget or another expectation
 * missed, and 2 when the reading is inconclusive or the run could not be set
 * up.
 */

import { readFile } from 'node:fs/promises';
import { arch, cpus, release, totalmem } from 'node:os';

import { Command, InvalidArgumentError } from 'commander';

import { referenceFiles } from '../data/reference-files.ts';
import { loadPlanSchema } from '../plan.ts';
import { writeAtomically } from '../runner/report.ts';
import { HOST_LOCATOR, isUnifiedHierarchy } from './cgroup.ts';
import {
  dockerContainerSource,
  dockerRunner,
  engineRefusal,
} from './docker.ts';
import { runFlip } from './flip.ts';
import { DEFAULT_SERVICES, MIB } from './limits.ts';
import {
  type FlipFigures,
  budgetExitCode,
  judgeBudget,
  renderBudgetMarkdown,
  renderSeriesCsv,
  restFigures,
} from './report.ts';
import { BudgetSampler } from './sampler.ts';
import {
  DEFAULT_HARNESS,
  type PreparedWorkload,
  WorkloadSetupError,
  prepareWorkload,
  runWorkload,
} from './workload.ts';

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

function serviceList(value: string): string[] {
  const services = value
    .split(',')
    .map((service) => service.trim())
    .filter((service) => service !== '');
  if (services.length === 0) {
    throw new InvalidArgumentError('expected one service or more');
  }
  return services;
}

interface BudgetFlags {
  plan: string;
  project: string;
  target?: string;
  harness: string;
  services: string[];
  settle: number;
  tail: number;
  deadline: number;
  flipCommand?: string;
  flipDeadline: number;
  cgroupRoot: string;
  proc: string;
  docker: string;
  report?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, Math.max(0, ms)));
}

function mibText(bytes: number): string {
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

async function budgetCommand(flags: BudgetFlags): Promise<0 | 1 | 2> {
  const plan = loadPlanSchema.parse(
    JSON.parse(await readFile(flags.plan, 'utf8')),
  );
  const target = flags.target ?? plan.target;
  const locator = { root: flags.cgroupRoot, proc: flags.proc };
  if (!isUnifiedHierarchy(locator.root)) {
    console.error(
      `[budget] ${locator.root} is no cgroup v2 mount: the budget reads cgroup v2's memory.stat`,
    );
    return 2;
  }
  const source = dockerContainerSource(
    flags.project,
    dockerRunner(flags.docker),
  );
  const refused = engineRefusal(await source.engine());
  if (refused !== null) {
    console.error(`[budget] ${refused}`);
    return 2;
  }

  console.log('[budget] making the reference files');
  const files = referenceFiles();
  for (const file of Object.values(files)) {
    console.log(`[budget]   ${file.fileName}: ${file.description}`);
  }
  let prepared: PreparedWorkload;
  try {
    prepared = await prepareWorkload({
      plan,
      target,
      harness: flags.harness,
      files,
    });
  } catch (error) {
    if (error instanceof WorkloadSetupError) {
      console.error(`[budget] setup failed: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const sampler = new BudgetSampler({ source, locator });
  try {
    await sampler.open();
    const listed = sampler.figures().containers;
    if (listed.length === 0) {
      console.error(
        `[budget] no container of the deployment ${flags.project} is running (Compose projects ${flags.project}, ${flags.project}-blue, ${flags.project}-green)`,
      );
      await sampler.stop();
      return 2;
    }
    console.log(
      `[budget] reading ${listed.length} containers every ${sampler.figures().intervalMs} ms: ${listed.map((c) => c.name).join(', ')}`,
    );
    sampler.run();
    await sleep(flags.settle * 1000);
    sampler.mark('workload');
    const workloadAtMs = sampler.elapsedMs();
    console.log(
      `[budget] at rest: ${mibText(sampler.latest()?.counted ?? 0)}; the workload starts`,
    );
    const workload = await runWorkload(prepared, {
      clock: () => sampler.elapsedMs(),
      deadlineMs: flags.deadline * 1000,
      reading: () => {
        const latest = sampler.latest();
        const peak = sampler.figures().peak;
        return `deployment ${mibText(latest?.counted ?? 0)} now, ${mibText(peak?.counted ?? 0)} at most`;
      },
    });
    sampler.mark('workload end');
    // The flip, if asked for: the overlap of two colours happens only then.
    let flip: FlipFigures | null = null;
    if (flags.flipCommand !== undefined) {
      console.log(
        `[budget] the workload ended after ${(workload.durationMs / 1000).toFixed(0)} s; the blue/green flip starts: ${flags.flipCommand}`,
      );
      sampler.mark('flip');
      flip = await runFlip({
        command: flags.flipCommand,
        deadlineMs: flags.flipDeadline * 1000,
        clock: () => sampler.elapsedMs(),
      });
      sampler.mark('flip end');
      console.log(
        `[budget] the flip ${flip.timedOut ? 'was stopped at its deadline' : `exited ${flip.exitCode ?? flip.signal ?? '?'}`} after ${((flip.endedAtMs - flip.startedAtMs) / 1000).toFixed(0)} s; ${sampler.figures().overlap.instants} instants read two colours; reading on for ${flags.tail} s`,
      );
    } else {
      console.log(
        `[budget] the workload ended after ${(workload.durationMs / 1000).toFixed(0)} s; reading on for ${flags.tail} s`,
      );
    }
    await sleep(flags.tail * 1000);
    const figures = await sampler.stop();
    const { series, ...sampling } = figures;
    const report = judgeBudget({
      settings: {
        target,
        project: flags.project,
        services: flags.services,
        organizationId: prepared.org.id,
        settleSeconds: flags.settle,
        tailSeconds: flags.tail,
        deadlineSeconds: flags.deadline,
        host: {
          arch: arch(),
          cpus: cpus().length,
          totalMemoryBytes: totalmem(),
          kernel: release(),
        },
      },
      sampling,
      rest: restFigures(series, workloadAtMs),
      workload,
      flip,
    });
    const stamp = sampling.startedAt.replace(/[:.]/g, '-');
    const path = flags.report ?? `budget-report-${stamp}.json`;
    const base = path.replace(/\.json$/, '');
    const markdown = renderBudgetMarkdown(report);
    await writeAtomically(path, `${JSON.stringify(report, null, 2)}\n`);
    await writeAtomically(`${base}.md`, markdown);
    await writeAtomically(`${base}.csv`, renderSeriesCsv(figures));
    console.log(markdown);
    console.log(`[budget] report written to ${path} (+ .md, .csv)`);
    return budgetExitCode(report);
  } finally {
    await sampler.stop();
    await prepared.close();
  }
}

export function createBudgetCommand(): Command {
  return new Command('budget')
    .description(
      'Read a `tale deploy` deployment’s memory (cgroup v2, every 250 ms) under the reference workload of tale#4942 and judge it against the 500 MB budget',
    )
    .requiredOption('--plan <path>', 'plan file written by `seed`')
    .requiredOption(
      '--project <id>',
      'the deployment’s Compose project: the `id` in its workspace’s tale.json',
    )
    .option(
      '--target <url>',
      'the deployment’s address (default: the plan’s target)',
    )
    .option(
      '--harness <name>',
      'the runtime the standard agent is pinned to for its task',
      DEFAULT_HARNESS,
    )
    .option(
      '--services <list>',
      'services that must be read for the reading to be whole',
      serviceList,
      [...DEFAULT_SERVICES],
    )
    .option(
      '--settle <seconds>',
      'seconds the deployment is read at rest before the workload',
      nonNegative,
      15,
    )
    .option(
      '--tail <seconds>',
      'seconds it is read after the workload ended',
      nonNegative,
      15,
    )
    .option(
      '--deadline <seconds>',
      'give up on parts of the workload still open after this long',
      positiveInteger,
      1_800,
    )
    .option(
      '--flip-command <command>',
      'a shell command run after the workload while the reading goes on, which flips the app tier to its other colour (the workspace’s `tale deploy`): the blue/green overlap is judged only when one happened',
    )
    .option(
      '--flip-deadline <seconds>',
      'stop the flip command after this long',
      positiveInteger,
      900,
    )
    .option('--cgroup-root <dir>', 'the cgroup v2 mount', HOST_LOCATOR.root)
    .option('--proc <dir>', 'the host’s process table', HOST_LOCATOR.proc)
    .option('--docker <binary>', 'the docker CLI', 'docker')
    .option(
      '--report <path>',
      'report path (.json; a .md and a .csv of the readings are written beside it)',
    )
    .action(async (flags: BudgetFlags) => {
      try {
        process.exitCode = await budgetCommand(flags);
      } catch (error) {
        console.error('[budget] failed:', error);
        process.exitCode = 2;
      }
    });
}
