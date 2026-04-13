import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { type ExecResult, exec } from './exec';

interface DockerComposeOptions {
  projectName?: string;
  cwd?: string;
  inherit?: boolean;
  onLine?: (line: string) => void;
  overrideFile?: string;
}

export async function pipeLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line) onLine(line.replace(/\r$/, ''));
    }
  }
  if (buffer) onLine(buffer.replace(/\r$/, ''));
}

export async function dockerCompose(
  composeContent: string,
  args: string[],
  options: DockerComposeOptions = {},
): Promise<ExecResult> {
  const {
    projectName = getProjectId(),
    cwd = process.cwd(),
    inherit = false,
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
      await Promise.all([
        pipeLines(proc.stdout, onLine),
        pipeLines(proc.stderr, onLine),
        proc.exited,
      ]);
      const exitCode = await proc.exited;
      return { success: exitCode === 0, stdout: '', stderr: '', exitCode };
    }

    if (inherit) {
      const proc = Bun.spawn(['docker', 'compose', ...composeFlags, ...args], {
        cwd,
        stdout: 'inherit',
        stderr: 'inherit',
      });
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
