import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';

import { runCaptured } from './common.ts';
import type { ResourceIO } from './linux-resources.ts';

export const nativeIO: ResourceIO = {
  host: { platform: process.platform, arch: process.arch },
  command: runCaptured,
  async readFile(path) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  },
  async writeExclusive(path, contents) {
    if (path.startsWith('/run/systemd/system/')) {
      assert.match(
        path,
        /^\/run\/systemd\/system\/talebench[a-f0-9]{32}\.slice$/,
      );
      const result = await nativeIO.command(
        'sudo',
        [
          '-n',
          'python3',
          '-c',
          'import os,sys; fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644); os.write(fd,sys.argv[2].encode()); os.close(fd)',
          path,
          contents,
        ],
        5000,
      );
      assert.equal(result.code, 0, 'Exclusive runtime unit creation failed');
      return;
    }
    await writeFile(path, contents, { flag: 'wx', mode: 0o600 });
  },
  async removeFile(path) {
    if (path.startsWith('/run/systemd/system/')) {
      assert.match(
        path,
        /^\/run\/systemd\/system\/talebench[a-f0-9]{32}\.slice$/,
      );
      const result = await nativeIO.command(
        'sudo',
        [
          '-n',
          'python3',
          '-c',
          'import os,sys\ntry: os.unlink(sys.argv[1])\nexcept FileNotFoundError: pass',
          path,
        ],
        5000,
      );
      assert.equal(result.code, 0, 'Owned runtime unit removal failed');
      return;
    }
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  },
};
