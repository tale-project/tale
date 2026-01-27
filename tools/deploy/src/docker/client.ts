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
  const { projectName = "tale", cwd } = options;

  const tempFile = `/tmp/tale-deploy-compose-${Date.now()}.yml`;
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

export async function pullImage(image: string): Promise<boolean> {
  logger.info(`Pulling image: ${image}`);
  const result = await docker("pull", image);
  if (!result.success) {
    logger.error(`Failed to pull image: ${image}`);
    logger.error(result.stderr);
    return false;
  }
  return true;
}

export async function imageExists(image: string): Promise<boolean> {
  const result = await docker("image", "inspect", image);
  return result.success;
}

export async function getContainerHealth(
  containerName: string
): Promise<"healthy" | "unhealthy" | "starting" | "none"> {
  const result = await docker(
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    containerName
  );

  if (!result.success) {
    return "none";
  }

  const status = result.stdout.trim();
  if (status === "healthy" || status === "unhealthy" || status === "starting") {
    return status;
  }
  return "none";
}

export async function isContainerRunning(containerName: string): Promise<boolean> {
  const result = await docker(
    "inspect",
    "--format",
    "{{.State.Running}}",
    containerName
  );
  return result.success && result.stdout.trim() === "true";
}

export async function stopContainer(containerName: string): Promise<boolean> {
  logger.info(`Stopping container: ${containerName}`);
  const result = await docker("stop", containerName);
  return result.success;
}

export async function removeContainer(containerName: string): Promise<boolean> {
  logger.info(`Removing container: ${containerName}`);
  const result = await docker("rm", "-f", containerName);
  return result.success;
}

export async function getContainerVersion(
  containerName: string
): Promise<string | null> {
  const result = await docker(
    "inspect",
    "--format",
    '{{index .Config.Labels "org.opencontainers.image.version"}}',
    containerName
  );

  if (!result.success || !result.stdout.trim()) {
    return null;
  }

  return result.stdout.trim();
}

export async function listContainers(
  filter?: string
): Promise<{ name: string; status: string; image: string }[]> {
  const args = ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}\t{{.Image}}"];
  if (filter) {
    args.push("--filter", filter);
  }

  const result = await docker(...args);
  if (!result.success || !result.stdout) {
    return [];
  }

  return result.stdout.split("\n").map((line) => {
    const [name, status, image] = line.split("\t");
    return { name, status, image };
  });
}
