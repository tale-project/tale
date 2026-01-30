import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type ExecResult, exec } from "./exec";

export async function dockerCompose(
  composeContent: string,
  args: string[],
  options: { projectName?: string; cwd?: string } = {}
): Promise<ExecResult> {
  const { projectName = "tale", cwd = process.cwd() } = options;

  // Write compose file to cwd so env_file paths resolve correctly
  const tempFile = join(cwd, `.tale-deploy-compose-${randomUUID()}.yml`);
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
