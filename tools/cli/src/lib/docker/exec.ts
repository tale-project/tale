import * as logger from '../../utils/logger';
import { exitedWithin } from './exited-within';

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    silent?: boolean;
    timeout?: number;
    /**
     * Pipe this string into the child's stdin and close. Required for the
     * `docker exec -i <container> bash -s` pattern used by reseed/migrate.
     */
    stdin?: string;
  } = {},
): Promise<ExecResult> {
  const { cwd, silent = false, timeout, stdin } = options;

  if (!silent) {
    logger.debug(`Executing: ${command} ${args.join(' ')}`);
  }

  const proc =
    stdin === undefined
      ? Bun.spawn([command, ...args], {
          cwd,
          stdout: 'pipe',
          stderr: 'pipe',
        })
      : Bun.spawn([command, ...args], {
          cwd,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        });

  if (stdin !== undefined) {
    const sink = (proc as Bun.Subprocess<'pipe', 'pipe', 'pipe'>).stdin;
    sink.write(stdin);
    await sink.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    timeout ? exitedWithin(proc, timeout) : proc.exited,
  ]);

  return {
    success: exitCode === 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  };
}
