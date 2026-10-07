import * as logger from '../../utils/logger';
import { boundedOutput } from './bounded-output';
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
    /** Combined stdout/stderr bound; requires a finite positive timeout. */
    maxOutputBytes?: number;
    /** Replace the inherited environment for managed deployment commands. */
    env?: Record<string, string | undefined>;
    /**
     * Pipe this string into the child's stdin and close. Required for the
     * `docker exec -i <container> bash -s` pattern used by reseed/migrate.
     */
    stdin?: string;
  } = {},
): Promise<ExecResult> {
  const { cwd, silent = false, timeout, stdin, env, maxOutputBytes } = options;
  if (
    maxOutputBytes !== undefined &&
    (!Number.isSafeInteger(maxOutputBytes) ||
      maxOutputBytes < 1 ||
      timeout === undefined ||
      !Number.isFinite(timeout) ||
      timeout <= 0)
  )
    throw new Error(
      'Bounded commands require a positive byte limit and timeout.',
    );

  if (!silent) {
    logger.debug(`Executing: ${command} ${args.join(' ')}`);
  }

  const proc =
    stdin === undefined
      ? Bun.spawn([command, ...args], {
          cwd,
          ...(env === undefined ? {} : { env }),
          stdout: 'pipe',
          stderr: 'pipe',
          ...(maxOutputBytes === undefined
            ? {}
            : { detached: process.platform !== 'win32' }),
        })
      : Bun.spawn([command, ...args], {
          cwd,
          ...(env === undefined ? {} : { env }),
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          ...(maxOutputBytes === undefined
            ? {}
            : { detached: process.platform !== 'win32' }),
        });

  if (maxOutputBytes !== undefined && timeout !== undefined)
    return boundedOutput(proc as Bun.Subprocess<'pipe', 'pipe', 'pipe'>, {
      timeout,
      maxOutputBytes,
      ...(stdin === undefined ? {} : { stdin }),
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
