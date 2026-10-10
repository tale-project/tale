/**
 * The platform's code runner: the supervised node-vm runner every host
 * evaluates templates and transform bodies with, installed once on first
 * use, with as many runner processes as this process's role should spend.
 * `main.ts` configures it from the environment (`AUTOMATION_RUNNER_PROCESSES`)
 * before anything runs; a host that runs without that boot (a script, a
 * test) gets the defaults for an all-in-one process.
 */

import { availableParallelism } from 'node:os';

import { hasCodeRunner, setCodeRunner } from '../../lib/engine/core/runner';
import {
  nodeVmRunner,
  type NodeVmRunnerOptions,
} from '../../lib/engine/runners/node-vm';

type Role = 'api' | 'worker' | 'all';

let options: NodeVmRunnerOptions = {
  processes: defaultRunnerProcesses('all'),
};

/**
 * Runner processes a role spends by default: two for the api, which only
 * evaluates test runs and previews; for a worker, which steps runs, one per
 * core but one, at most four. Each process starts only when the ones before
 * it are full, and one beyond the first stops after five idle minutes.
 */
export function defaultRunnerProcesses(
  role: Role,
  cores: number = availableParallelism(),
): number {
  return role === 'api' ? 2 : Math.min(4, Math.max(1, cores - 1));
}

/** Set how many runner processes this process may use, from its role and
 * `AUTOMATION_RUNNER_PROCESSES` when set. Before the runner is installed. */
export function configureCodeRunner(settings: {
  role: Role;
  processes?: number;
}): void {
  options = {
    processes: settings.processes ?? defaultRunnerProcesses(settings.role),
  };
}

/** Install the platform's code runner unless one is installed already: a
 * deployment that installs its own sandbox backend keeps it. */
export function installCodeRunner(): void {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner(options));
}
