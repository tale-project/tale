// A raw device's move to its hub's release (docs/raw.md): the device runs
// from its own copy of the release's `tale` binary, so the update is that
// binary's `tale sandbox update`, started detached: it fetches the release's
// binary, checks it against the release's checksums, puts it in place, records
// the outcome in `update-status.json` beside the config and has the device's
// service start again from it. The Docker stack's updater container
// (apply.ts) has no part in it.

import { spawn } from 'node:child_process';

export async function launchRawSelfUpdate(
  configPath: string,
  version: string,
): Promise<void> {
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`not a release to update to: ${JSON.stringify(version)}`);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'sandbox',
        'update',
        '--config',
        configPath,
        '--to',
        version,
        '--from-device',
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
