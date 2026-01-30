import * as logger from "../../utils/logger";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(
  command: string,
  args: string[],
  options: { cwd?: string; silent?: boolean; timeout?: number } = {}
): Promise<ExecResult> {
  const { cwd, silent = false, timeout } = options;

  if (!silent) {
    logger.debug(`Executing: ${command} ${args.join(" ")}`);
  }

  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitPromise = timeout
    ? Promise.race([
        proc.exited,
        new Promise<number>((_, reject) =>
          setTimeout(() => {
            proc.kill();
            reject(new Error(`Command timed out after ${timeout}s`));
          }, timeout * 1000)
        ),
      ])
    : proc.exited;

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    exitPromise,
  ]);

  return {
    success: exitCode === 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  };
}

