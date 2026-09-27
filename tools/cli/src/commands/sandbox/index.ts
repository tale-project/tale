import { Command, InvalidArgumentError, Option } from 'commander';

import {
  connectSandboxDevice,
  disconnectSandboxDevice,
  sandboxDeviceLogs,
  sandboxDeviceStatus,
  updateSandboxDevice,
} from '../../lib/actions/sandbox-device';
import { action } from '../../utils/run-command';

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 256) {
    throw new InvalidArgumentError('expected a whole number from 1 to 256');
  }
  return n;
}

/**
 * `tale sandbox` — run a Tale organization's sandboxes on this machine.
 * Settings → Sandboxes → Add device hands out the one line that installs the
 * CLI and runs `connect`; everything else looks after the connected device.
 */
export function createSandboxCommand(): Command {
  const sandbox = new Command('sandbox').description(
    "Run your Tale organization's sandboxes on this machine",
  );
  sandbox.addHelpText(
    'after',
    `
Connect a Linux or macOS machine with Docker as a sandbox device. Copy the
command from Settings → Sandboxes → Add device; it looks like:

  tale sandbox connect https://your-tale-site --token tsdj_…

The device dials out to your Tale site over HTTPS (nothing listens for
incoming connections), keeps running after restarts, and updates itself when
Tale is updated. Its state lives in ~/.tale/sandbox (TALE_SANDBOX_HOME).
`,
  );

  sandbox
    .command('connect')
    .description(
      'Connect this machine to a Tale organization as a sandbox device',
    )
    .argument('<site>', 'your Tale site, e.g. https://your-org.tale.dev')
    .requiredOption('--token <token>', 'the one-time connect token (tsdj_…)')
    .option('--name <name>', 'the name Tale shows (default: this hostname)')
    .option(
      '--max-sessions <n>',
      'how many sandboxes may run here at once (default: from CPUs and memory)',
      positiveInt,
    )
    .option('--no-auto-update', 'do not follow the server release by itself')
    .option(
      '--docker-socket <path>',
      'the Docker socket as the daemon sees it (rootless Docker)',
    )
    // Development against a local server: where the device's containers
    // reach the site, and local image builds instead of a release.
    .addOption(
      sandboxHidden('--device-server-url <url>', 'site URL for the containers'),
    )
    .addOption(sandboxHidden('--image-sandbox <ref>', 'spawner image'))
    .addOption(sandboxHidden('--image-runtime <ref>', 'session runtime image'))
    .addOption(sandboxHidden('--image-egress <ref>', 'egress proxy image'))
    .addOption(sandboxHidden('--image-tag <tag>', 'release tag to run'))
    .action(
      action(
        async (
          site: string,
          opts: {
            token: string;
            name?: string;
            maxSessions?: number;
            autoUpdate: boolean;
            dockerSocket?: string;
            deviceServerUrl?: string;
            imageSandbox?: string;
            imageRuntime?: string;
            imageEgress?: string;
            imageTag?: string;
          },
        ) => {
          const images =
            opts.imageSandbox || opts.imageRuntime || opts.imageEgress
              ? {
                  ...(opts.imageSandbox ? { sandbox: opts.imageSandbox } : {}),
                  ...(opts.imageRuntime ? { runtime: opts.imageRuntime } : {}),
                  ...(opts.imageEgress ? { egress: opts.imageEgress } : {}),
                }
              : undefined;
          await connectSandboxDevice({
            url: site,
            token: opts.token,
            autoUpdate: opts.autoUpdate,
            ...(opts.name !== undefined ? { name: opts.name } : {}),
            ...(opts.maxSessions !== undefined
              ? { maxSessions: opts.maxSessions }
              : {}),
            ...(opts.dockerSocket !== undefined
              ? { dockerSocket: opts.dockerSocket }
              : {}),
            ...(opts.deviceServerUrl !== undefined
              ? { deviceServerUrl: opts.deviceServerUrl }
              : {}),
            ...(images !== undefined ? { images } : {}),
            ...(opts.imageTag !== undefined ? { imageTag: opts.imageTag } : {}),
          });
        },
      ),
    );

  sandbox
    .command('status')
    .description('Show the device, its containers and its connection')
    .action(
      action(async () => {
        await sandboxDeviceStatus();
      }),
    );

  sandbox
    .command('update')
    .description("Move the device to the server's release now")
    .addOption(sandboxHidden('--image-tag <tag>', 'release tag to run'))
    .action(
      action(async (opts: { imageTag?: string }) => {
        await updateSandboxDevice(
          opts.imageTag !== undefined ? { imageTag: opts.imageTag } : {},
        );
      }),
    );

  sandbox
    .command('logs')
    .description("Show the device's log")
    .option('-f, --follow', 'keep printing new lines', false)
    .option('--tail <n>', 'lines to show first', positiveIntOrZero, 200)
    .action(
      action(async (opts: { follow: boolean; tail: number }) => {
        await sandboxDeviceLogs({ follow: opts.follow, tail: opts.tail });
      }),
    );

  sandbox
    .command('disconnect')
    .description(
      'Remove this machine from its organization and stop its sandboxes',
    )
    .option('--keep-data', 'keep the workspaces on this machine', false)
    .option('-f, --force', 'do not ask for confirmation', false)
    .action(
      action(async (opts: { keepData: boolean; force: boolean }) => {
        await disconnectSandboxDevice({
          keepData: opts.keepData,
          force: opts.force,
        });
      }),
    );

  return sandbox;
}

function positiveIntOrZero(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError('expected a whole number');
  }
  return n;
}

function sandboxHidden(flags: string, description: string): Option {
  return new Option(flags, `(development) ${description}`).hideHelp();
}
