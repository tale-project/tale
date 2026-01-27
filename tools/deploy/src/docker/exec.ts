import * as logger from "../utils/logger";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(
  command: string,
  args: string[],
  options: { cwd?: string; silent?: boolean } = {}
): Promise<ExecResult> {
  const { cwd, silent = false } = options;

  if (!silent) {
    logger.debug(`Executing: ${command} ${args.join(" ")}`);
  }

  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return {
    success: exitCode === 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  };
}

