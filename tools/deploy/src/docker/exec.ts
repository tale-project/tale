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

export async function docker(...args: string[]): Promise<ExecResult> {
  return exec("docker", args);
}

export async function dockerCompose(
  composeContent: string,
  args: string[],
  options: { projectName?: string; cwd?: string } = {}
): Promise<ExecResult> {
  const { projectName = "tale", cwd = process.cwd() } = options;

  // Write compose file to cwd so env_file paths resolve correctly
  const tempFile = `${cwd}/.tale-deploy-compose-${Date.now()}.yml`;
  await Bun.write(tempFile, composeContent);

  try {
    return await exec(
      "docker",
      ["compose", "-p", projectName, "-f", tempFile, ...args],
      { cwd }
    );
  } finally {
    const { unlink } = await import("node:fs/promises");
    await unlink(tempFile).catch(() => {});
  }
}
