/** `stack up|down|status` as commands. */

import { Command, InvalidArgumentError } from 'commander';

import { stackDown, stackStatus, stackUp } from './stack.ts';

function nonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('expected a non-negative integer');
  }
  return parsed;
}

function keyValue(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const at = value.indexOf('=');
  if (at <= 0) throw new InvalidArgumentError('expected KEY=value');
  return { ...previous, [value.slice(0, at)]: value.slice(at + 1) };
}

export function createStackCommand(): Command {
  const stack = new Command('stack').description(
    'Run a local, horizontally scaled platform backend (N api + M worker processes) for load runs',
  );
  stack
    .command('up')
    .description('Start the processes and wait until every api answers ready')
    .requiredOption('--platform <dir>', 'the services/platform directory')
    .requiredOption(
      '--env-file <path>',
      'env file with DATABASE_URL, secrets, object store, …',
    )
    .option('--api <n>', 'api processes', nonNegativeInteger, 2)
    .option('--workers <n>', 'worker processes', nonNegativeInteger, 1)
    .option(
      '--base-port <port>',
      'port of the first api process',
      nonNegativeInteger,
      4105,
    )
    .option('--host <host>', 'interface the processes listen on', '127.0.0.1')
    .option(
      '--state <path>',
      'state file `down` reads',
      '.tale-load-stack.json',
    )
    .option(
      '--logs <dir>',
      'directory for the process logs',
      '.tale-load-stack-logs',
    )
    .option(
      '--mock-port <port>',
      'also start the mock provider on this port',
      nonNegativeInteger,
    )
    .option(
      '--mock-processes <n>',
      'mock provider processes',
      nonNegativeInteger,
      2,
    )
    .option(
      '--node-options <flags>',
      'extra Node flags for the platform processes',
      '',
    )
    .option(
      '--set <KEY=value>',
      'env override on top of the env file (repeatable)',
      keyValue,
      {},
    )
    .option(
      '--ready-timeout <ms>',
      'how long to wait for readiness',
      nonNegativeInteger,
      180_000,
    )
    .action(
      async (flags: {
        platform: string;
        envFile: string;
        api: number;
        workers: number;
        basePort: number;
        host: string;
        state: string;
        logs: string;
        mockPort?: number;
        mockProcesses: number;
        nodeOptions: string;
        set: Record<string, string>;
        readyTimeout: number;
      }) => {
        try {
          const state = await stackUp({
            platformDir: flags.platform,
            envFile: flags.envFile,
            api: flags.api,
            workers: flags.workers,
            basePort: flags.basePort,
            host: flags.host,
            stateFile: flags.state,
            logDir: flags.logs,
            mockPort: flags.mockPort ?? null,
            mockProcesses: flags.mockProcesses,
            nodeOptions: flags.nodeOptions,
            extraEnv: flags.set,
            readyTimeoutMs: flags.readyTimeout,
          });
          console.log(
            `[stack] up: ${state.processes.length} processes; targets ${state.apiUrls.join(',')}${state.mockUrl === null ? '' : `; mock ${state.mockUrl}`}`,
          );
        } catch (error) {
          console.error('[stack] up failed:', error);
          process.exitCode = 1;
        }
      },
    );
  stack
    .command('down')
    .description('Stop every process `up` started')
    .option('--state <path>', 'state file', '.tale-load-stack.json')
    .option(
      '--grace <ms>',
      'SIGTERM grace before SIGKILL',
      nonNegativeInteger,
      30_000,
    )
    .action(async (flags: { state: string; grace: number }) => {
      try {
        const { stopped, killed } = await stackDown(flags.state, flags.grace);
        console.log(`[stack] down: ${stopped} stopped, ${killed} killed`);
      } catch (error) {
        console.error('[stack] down failed:', error);
        process.exitCode = 1;
      }
    });
  stack
    .command('status')
    .description('Show which processes are alive and ready')
    .option('--state <path>', 'state file', '.tale-load-stack.json')
    .action(async (flags: { state: string }) => {
      try {
        for (const p of await stackStatus(flags.state)) {
          console.log(
            `${p.role.padEnd(6)} pid=${p.pid} port=${p.port ?? '-'} alive=${p.alive} ready=${p.ready ?? '-'}`,
          );
        }
      } catch (error) {
        console.error('[stack] status failed:', error);
        process.exitCode = 1;
      }
    });
  return stack;
}
