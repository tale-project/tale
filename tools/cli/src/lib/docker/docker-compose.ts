import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { PROJECT_NAME } from '../../utils/load-env';
import { type ExecResult, exec } from './exec';

export async function dockerCompose(
  composeContent: string,
  args: string[],
  options: { projectName?: string; cwd?: string; inherit?: boolean } = {},
): Promise<ExecResult> {
  const {
    projectName = PROJECT_NAME,
    cwd = process.cwd(),
    inherit = false,
  } = options;

  // Write compose file to cwd so env_file paths resolve correctly
  const tempFile = join(cwd, `.tale-deploy-compose-${randomUUID()}.yml`);
  await Bun.write(tempFile, composeContent);

  try {
    if (inherit) {
      const proc = Bun.spawn(
        ['docker', 'compose', '-p', projectName, '-f', tempFile, ...args],
        { cwd, stdout: 'inherit', stderr: 'inherit' },
      );
      const exitCode = await proc.exited;
      return { success: exitCode === 0, stdout: '', stderr: '', exitCode };
    }

    return await exec(
      'docker',
      ['compose', '-p', projectName, '-f', tempFile, ...args],
      { cwd },
    );
  } finally {
    const { unlink } = await import('node:fs/promises');
    await unlink(tempFile).catch(() => {});
  }
}
