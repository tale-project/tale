import { readFile } from 'node:fs/promises';

import { Command, InvalidArgumentError, Option } from 'commander';

import {
  connectSandboxDevice,
  disconnectSandboxDevice,
  sandboxDeviceLogs,
  sandboxDeviceStatus,
  updateSandboxDevice,
} from '../../lib/actions/sandbox-device';
import {
  sandboxDeviceConfigPath,
  sandboxDeviceHome,
} from '../../lib/sandbox-device/config';
import { runRawDevice } from '../../lib/sandbox-device/raw/launch';
import { usageError } from '../../utils/fail';
import { action } from '../../utils/run-command';

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

/** The join token from the flag, a file, or TALE_SANDBOX_JOIN_TOKEN — the
 * last two keep it off the command line (and so out of process listings),
 * which is how a machine's manager passes it. */
async function joinToken(opts: {
  token?: string;
  tokenFile?: string;
}): Promise<string> {
  const given = [opts.token, opts.tokenFile].filter(
    (value) => value !== undefined,
  ).length;
  if (given > 1) {
    throw usageError('Give the connect token once: --token or --token-file.');
  }
  if (opts.token !== undefined) return opts.token.trim();
  if (opts.tokenFile !== undefined) {
    return (await readFile(opts.tokenFile, 'utf8')).trim();
  }
  const fromEnv = process.env.TALE_SANDBOX_JOIN_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  throw usageError(
    'The connect token is missing.',
    'Copy the command from Settings → Sandboxes → Add device (it carries --token tsdj_…).',
  );
}

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
Connect a Linux or macOS machine as a sandbox device. Copy the command from
Settings → Sandboxes → Add device; it looks like:

  tale sandbox connect https://your-tale-site --token tsdj_…

The device dials out to your Tale site over HTTPS (nothing listens for
incoming connections), keeps running after restarts, and updates itself when
Tale is updated. Its state lives in ~/.tale/sandbox (TALE_SANDBOX_HOME).

By default its sandboxes run in Docker containers. With --runtime raw they run
directly on this machine instead, with the harnesses installed here (Claude
Code, Codex, …) and no container or virtual machine:

  sudo tale sandbox connect https://your-tale-site --token tsdj_… --runtime raw
      each sandbox runs as an account of its own (isolated); its directory is
      /var/lib/tale-sandbox (macOS: /usr/local/var/tale-sandbox)
  tale sandbox connect https://your-tale-site --token tsdj_… --runtime raw
      every sandbox runs as you (shared): for a machine you use alone
`,
  );

  sandbox
    .command('connect')
    .description(
      'Connect this machine to a Tale organization as a sandbox device',
    )
    .argument('<site>', 'your Tale site, e.g. https://your-org.tale.dev')
    .option('--token <token>', 'the one-time connect token (tsdj_…)')
    .option(
      '--token-file <path>',
      'read the connect token from a file (or set TALE_SANDBOX_JOIN_TOKEN)',
    )
    .addOption(
      new Option('--runtime <runtime>', 'where the sandboxes run')
        .choices(['docker', 'raw'])
        .default('docker'),
    )
    .addOption(
      new Option(
        '--isolation <isolation>',
        'raw: each sandbox as its own account (isolated, needs root) or all as you (shared)',
      ).choices(['isolated', 'shared']),
    )
    .option(
      '--slot <account>',
      'raw, isolated: an existing account to run sandboxes as (repeat; default: made here)',
      collect,
    )
    .option('--root <dir>', "raw: the device's directory")
    .option(
      '--path <dir>',
      'raw: where harnesses are installed, searched before the system (repeat)',
      collect,
    )
    .option(
      '--binary <path>',
      'raw: the tale binary the device runs from (default: a copy of this one)',
    )
    .option(
      '--no-service',
      'raw: start no service; run `tale sandbox device run` yourself',
    )
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
            token?: string;
            tokenFile?: string;
            runtime: 'docker' | 'raw';
            isolation?: 'isolated' | 'shared';
            slot?: string[];
            root?: string;
            path?: string[];
            binary?: string;
            service: boolean;
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
          const raw = opts.runtime === 'raw';
          if (
            !raw &&
            (opts.isolation !== undefined ||
              opts.slot !== undefined ||
              opts.root !== undefined ||
              opts.path !== undefined ||
              opts.binary !== undefined ||
              !opts.service)
          ) {
            throw usageError(
              '--isolation, --slot, --root, --path, --binary and --no-service are for --runtime raw.',
            );
          }
          await connectSandboxDevice({
            url: site,
            token: await joinToken(opts),
            runtime: opts.runtime,
            ...(raw
              ? {
                  raw: {
                    service: opts.service,
                    ...(opts.isolation !== undefined
                      ? { isolation: opts.isolation }
                      : {}),
                    ...(opts.slot !== undefined ? { slots: opts.slot } : {}),
                    ...(opts.root !== undefined ? { root: opts.root } : {}),
                    ...(opts.path !== undefined ? { path: opts.path } : {}),
                    ...(opts.binary !== undefined
                      ? { binary: opts.binary }
                      : {}),
                  },
                }
              : {}),
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
    .addOption(
      new Option('--to <version>', 'raw: the release to move to').hideHelp(),
    )
    .addOption(
      new Option('--from-device', 'raw: the device itself asked').hideHelp(),
    )
    .addOption(new Option('--config <path>', "the device's config").hideHelp())
    .action(
      action(
        async (opts: {
          imageTag?: string;
          to?: string;
          fromDevice?: boolean;
          config?: string;
        }) => {
          await updateSandboxDevice({
            ...(opts.imageTag !== undefined ? { imageTag: opts.imageTag } : {}),
            ...(opts.to !== undefined ? { to: opts.to } : {}),
            ...(opts.fromDevice === true ? { fromDevice: true } : {}),
            ...(opts.config !== undefined ? { configPath: opts.config } : {}),
          });
        },
      ),
    );

  // A raw device itself: what its service runs (services/sandbox/docs/raw.md).
  const device = new Command('device')
    .description('(internal) run a raw sandbox device in this process')
    .helpCommand(false);
  device
    .command('run')
    .description('Run this raw sandbox device until it is stopped')
    .option(
      '--config <path>',
      "the device's config (default: the device home's device.json)",
    )
    .action(
      action(async (opts: { config?: string }) => {
        await runRawDevice(
          opts.config ?? sandboxDeviceConfigPath(sandboxDeviceHome()),
        );
        // The spawner keeps this process alive; its service stops it.
        await new Promise<never>(() => {});
      }),
    );
  sandbox.addCommand(device, { hidden: true });

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
