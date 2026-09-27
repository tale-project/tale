import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { pipeLines } from '@tale/shared/process';

import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { type ExecResult, exec } from './exec';

interface DockerComposeOptions {
  projectName?: string;
  cwd?: string;
  onLine?: (line: string) => void;
  overrideFile?: string;
}

export async function dockerCompose(
  composeContent: string,
  args: string[],
  options: DockerComposeOptions = {},
): Promise<ExecResult> {
  const {
    projectName = getProjectId(),
    cwd = process.cwd(),
    onLine,
    overrideFile,
  } = options;

  // Write compose file to cwd so env_file paths resolve correctly
  const tempFile = join(cwd, `.tale-deploy-compose-${randomUUID()}.yml`);
  await Bun.write(tempFile, composeContent);

  const composeFlags = ['-p', projectName, '-f', tempFile];
  if (overrideFile) {
    composeFlags.push('-f', overrideFile);
  }

  try {
    if (onLine) {
      const proc = Bun.spawn(['docker', 'compose', ...composeFlags, ...args], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      // A blank compose line carries nothing, so it never reaches the caller;
      // a long one arrives whole, never capped.
      const forward = (line: string) => {
        if (line) onLine(line);
      };
      await Promise.all([
        pipeLines(proc.stdout, forward, Number.POSITIVE_INFINITY),
        pipeLines(proc.stderr, forward, Number.POSITIVE_INFINITY),
        proc.exited,
      ]);
      const exitCode = await proc.exited;
      return { success: exitCode === 0, stdout: '', stderr: '', exitCode };
    }

    return await exec('docker', ['compose', ...composeFlags, ...args], {
      cwd,
    });
  } finally {
    const { unlink } = await import('node:fs/promises');
    await unlink(tempFile).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        logger.debug(
          `Failed to remove temp compose file ${tempFile}: ${err.message}`,
        );
      }
    });
  }
}
