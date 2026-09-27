// Entry point of `device-apply` (dispatched by entrypoint.sh):
//
//   device-apply <config.json> [--version <release>]
//
// Lays the device stack out at <release> (default: this image's own
// TALE_VERSION) and records the outcome in the device's update status, which
// the device reports to its organization. Exit 0 on success, 1 on failure,
// 2 on a usage error.

import { applyDeviceStack, readAppliedVersion } from './apply.ts';
import {
  DeviceConfigError,
  loadDeviceConfig,
  writeUpdateStatus,
} from './device-config.ts';

async function main(argv: string[]): Promise<number> {
  const configPath = argv[0];
  if (configPath === undefined || configPath.startsWith('-')) {
    console.error('usage: device-apply <config.json> [--version <release>]');
    return 2;
  }
  const versionFlag = argv.indexOf('--version');
  const version =
    (versionFlag >= 0 ? argv[versionFlag + 1] : undefined) ??
    process.env.TALE_VERSION ??
    'dev';
  let config;
  try {
    config = await loadDeviceConfig(configPath);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return err instanceof DeviceConfigError ? 2 : 1;
  }
  // What ran before — put back if this release cannot be laid out, so a
  // failed update never leaves the machine without a working device.
  const previous = await readAppliedVersion(config);
  try {
    await applyDeviceStack(config, configPath, version);
    await writeUpdateStatus(config.stateDir, {
      state: 'idle',
      targetVersion: version,
      error: null,
      atMs: Date.now(),
    });
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`device-apply: ${message}`);
    if (previous !== null && previous !== version) {
      console.error(`device-apply: putting ${previous} back`);
      // Its images are still on the machine: no registry needed.
      await applyDeviceStack(config, configPath, previous).catch(
        (restoreErr: unknown) => {
          console.error(
            `device-apply: putting ${previous} back failed:`,
            restoreErr,
          );
        },
      );
    }
    await writeUpdateStatus(config.stateDir, {
      state: 'failed',
      targetVersion: version,
      error: message.slice(0, 500),
      atMs: Date.now(),
    }).catch((writeErr: unknown) => {
      console.error('device-apply: recording the failure failed:', writeErr);
    });
    return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
