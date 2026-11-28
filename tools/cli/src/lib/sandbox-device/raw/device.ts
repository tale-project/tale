import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { cpus as osCpus, totalmem } from 'node:os';
import { join } from 'node:path';

import { CliError, preconditionError, usageError } from '../../../utils/fail';
import * as logger from '../../../utils/logger';
import {
  commitInstall,
  installBinary,
  resolveRelease,
  rollbackInstall,
} from '../../version/self-update';
import {
  buildSandboxDeviceConfig,
  defaultIsolatedRoot,
  defaultMaxSessions,
  isReleaseVersion,
  readSandboxDeviceConfig,
  sandboxDeviceConfigPath,
  type SandboxDeviceConfig,
  type SandboxDeviceJoinAnswer,
  type SandboxDeviceRaw,
  writeSandboxDeviceConfig,
} from '../config';
import { readUpdateStatus } from '../stack';
import {
  makeSlotAccounts,
  readAccount,
  removeSlotAccounts,
  type SlotAccount,
} from './accounts';
import { realHost, type RawHost } from './host';
import { deviceVersion, systemPath } from './launch';
import {
  installService,
  logCommand,
  removeService,
  restartService,
  serviceKindFor,
  type RawServiceKind,
} from './service';

/**
 * A raw sandbox device — one that runs its sessions directly on this machine,
 * with no container (services/sandbox/docs/raw.md): what `tale sandbox
 * connect --runtime raw` sets up and the other `tale sandbox` verbs look
 * after. The join, the server's view and the relays are a Docker device's
 * (actions/sandbox-device.ts); what differs is here: the slot accounts, the
 * device's own `tale` binary, its service, and its update.
 */

/** Where an isolated device's harnesses are installed by default (the
 * prefix hostkit installs them under), before the system's own. */
export const DEFAULT_ISOLATED_PATH = ['/opt/tale-agents/bin'];

/** A path a session's view carries verbatim: no space or quote. */
const PLAIN_PATH = /^\/[A-Za-z0-9._~/+@%-]*[A-Za-z0-9._~+@%-]$/;

export interface RawConnectOptions {
  isolation?: 'isolated' | 'shared';
  /** Existing accounts to run sessions as (isolated; made by the machine's
   * manager). Absent: `connect` makes one per session. */
  slots?: string[];
  root?: string;
  /** Where harnesses are installed (each before the system's PATH). */
  path?: string[];
  /** The `tale` binary the device runs from (hostkit installs one). Absent:
   * a copy of this one, in the device's root. */
  binary?: string;
  /** Write no service: the caller runs `tale sandbox device run` itself. */
  service: boolean;
}

/** What a raw connect settles before it spends the join token. */
export interface RawPlan {
  isolation: 'isolated' | 'shared';
  root: string;
  path: string[];
  service: RawServiceKind;
  machine: { cpus: number | null; memoryBytes: number | null };
}

export function planRawDevice(
  options: RawConnectOptions,
  host: Pick<RawHost, 'isRoot' | 'os'>,
  stateDir: string,
): RawPlan {
  const isolation =
    options.isolation ?? (host.isRoot() ? 'isolated' : 'shared');
  if (isolation === 'isolated' && !host.isRoot()) {
    throw preconditionError(
      'An isolated raw device runs each sandbox as an account of its own, which takes root.',
      [
        'sudo tale sandbox connect … --runtime raw',
        'or: tale sandbox connect … --runtime raw --isolation shared   # every sandbox runs as you',
      ],
    );
  }
  if (isolation === 'shared' && host.isRoot()) {
    throw preconditionError(
      'A shared raw device runs every sandbox as the account that connects it, and never as root.',
      ['Connect it as an ordinary account, or choose --isolation isolated.'],
    );
  }
  const root =
    options.root ??
    (isolation === 'isolated' ? defaultIsolatedRoot(host.os()) : stateDir);
  if (!PLAIN_PATH.test(root)) {
    throw usageError(
      `The device's directory must be a plain absolute path (letters, digits and ._~+@%- only): ${root}`,
      'Pass another with --root.',
    );
  }
  if (options.slots !== undefined && isolation !== 'isolated') {
    throw usageError('--slot names the accounts of an isolated device.');
  }
  for (const dir of options.path ?? []) {
    if (!dir.startsWith('/') || dir.includes(':')) {
      throw usageError(
        `--path takes absolute directories without ':' (got ${dir}).`,
      );
    }
  }
  const path =
    options.path ??
    (isolation === 'isolated' ? DEFAULT_ISOLATED_PATH : sharedPath(host.os()));
  const cores = osCpus().length;
  const memory = totalmem();
  return {
    isolation,
    root,
    path,
    service: options.service ? serviceKindFor(host.os(), isolation) : 'none',
    machine: {
      cpus: cores > 0 ? cores : null,
      memoryBytes: memory > 0 ? memory : null,
    },
  };
}

/** Where a shared device's owner usually has harnesses: the user's own
 * install directories, before the system's. */
function sharedPath(os: NodeJS.Platform): string[] {
  const home = process.env.HOME ?? '';
  const own =
    home === ''
      ? []
      : [
          join(home, '.local', 'bin'),
          join(home, '.bun', 'bin'),
          join(home, '.npm-global', 'bin'),
        ];
  return [
    ...own.filter((dir) => PLAIN_PATH.test(dir)),
    ...(os === 'darwin' ? ['/opt/homebrew/bin'] : []),
  ];
}

/** The device's slot accounts: the ones named, or one per session made now. */
export async function settleSlots(
  options: RawConnectOptions,
  plan: RawPlan,
  maxSessions: number,
  host: RawHost,
): Promise<{ slots: SlotAccount[]; made: boolean }> {
  if (plan.isolation === 'shared') return { slots: [], made: false };
  if (options.slots !== undefined && options.slots.length > 0) {
    const slots: SlotAccount[] = [];
    for (const user of options.slots) slots.push(await readAccount(host, user));
    if (slots.length < maxSessions) {
      throw usageError(
        `An isolated device runs one sandbox per slot account: --max-sessions ${maxSessions} needs ${maxSessions} --slot accounts, not ${slots.length}.`,
      );
    }
    return { slots, made: false };
  }
  logger.step(
    `Making ${maxSessions} slot account${maxSessions === 1 ? '' : 's'} for the sandboxes…`,
  );
  return {
    slots: await makeSlotAccounts(host, plan.root, maxSessions),
    made: true,
  };
}

/** The `tale` binary the device runs from: the one given, or a copy of this
 * one in the device's root, which neither the user's own `tale update` nor
 * anyone but the device's owner can change. */
export async function settleBinary(
  options: RawConnectOptions,
  root: string,
  host: RawHost,
): Promise<string> {
  if (options.binary !== undefined) {
    if (!options.binary.startsWith('/')) {
      throw usageError('--binary takes an absolute path.');
    }
    return options.binary;
  }
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true, mode: 0o755 });
  await chmod(bin, 0o755);
  const target = join(bin, 'tale');
  const staging = `${target}.${process.pid}.new`;
  await copyFile(host.execPath(), staging);
  await chmod(staging, 0o755);
  await rename(staging, target);
  return target;
}

export function rawJoinPlatform(
  plan: RawPlan,
  host: Pick<RawHost, 'os'>,
): {
  os: string;
  arch: string;
  cpus: number | null;
  memoryBytes: number | null;
  dockerVersion: null;
  runtime: 'raw';
  isolation: 'isolated' | 'shared';
} {
  return {
    os: host.os(),
    arch: process.arch,
    cpus: plan.machine.cpus,
    memoryBytes: plan.machine.memoryBytes,
    dockerVersion: null,
    runtime: 'raw',
    isolation: plan.isolation,
  };
}

export function rawMaxSessions(
  requested: number | undefined,
  plan: RawPlan,
  slotCount: number | null,
): number {
  const max =
    requested ??
    defaultMaxSessions(plan.machine.cpus, plan.machine.memoryBytes);
  if (slotCount !== null && slotCount > 0 && max > slotCount) return slotCount;
  return max;
}

/** Lay the device out once the server let it join: its config (with its
 * raw settings) and its service. */
export async function finishRawConnect(
  joined: SandboxDeviceJoinAnswer,
  plan: RawPlan,
  settled: { slots: SlotAccount[]; made: boolean; binary: string },
  options: {
    maxSessions: number;
    autoUpdate: boolean;
    cliServerUrl: string;
    hostname: string;
  },
  host: RawHost,
): Promise<SandboxDeviceConfig> {
  const raw: SandboxDeviceRaw = {
    isolation: plan.isolation,
    root: plan.root,
    slots: settled.slots,
    madeSlots: settled.made,
    path: plan.path,
    binary: settled.binary,
    service: plan.service,
  };
  const config: SandboxDeviceConfig = {
    ...buildSandboxDeviceConfig(joined, {
      stateDir: plan.root,
      maxSessions: options.maxSessions,
      host: { os: host.os(), arch: process.arch, hostname: options.hostname },
      autoUpdate: options.autoUpdate,
      cliServerUrl: options.cliServerUrl,
    }),
    runtime: 'raw',
    raw,
  };
  const configPath = sandboxDeviceConfigPath(plan.root);
  await writeSandboxDeviceConfig(config, configPath);
  if (plan.service !== 'none') {
    logger.step('Starting the sandbox device service…');
    await installService(
      {
        kind: plan.service,
        binary: settled.binary,
        configPath,
        stateDir: plan.root,
      },
      host,
    );
  }
  return config;
}

// ── Update ────────────────────────────────────────────────────────────────

/** The status file a raw update writes, as the Docker updater does. */
async function writeUpdateStatus(
  stateDir: string,
  status: {
    state: 'updating' | 'failed' | 'idle';
    targetVersion: string;
    error: string | null;
  },
): Promise<void> {
  const path = join(stateDir, 'update-status.json');
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ ...status, atMs: Date.now() })}\n`,
    { mode: 0o644 },
  );
  await rename(temporary, path);
}

/**
 * Move a raw device to `version`: the release's binary replaces the device's
 * (fetched, checked against the release's own checksums, then tried with
 * `--version`), and the service starts again from it. `fromDevice`: the
 * device asked (its hub runs that release) — the outcome goes to
 * `update-status.json`, which the device reports.
 */
export async function updateRawDevice(
  config: SandboxDeviceConfig,
  version: string,
  options: { fromDevice: boolean },
  host: RawHost = realHost,
): Promise<void> {
  const raw = config.raw;
  if (raw === undefined) throw new Error('not a raw device');
  if (!isReleaseVersion(version)) {
    throw preconditionError(
      `The server runs a development build (${version || 'unknown'}), which publishes no binary to follow.`,
    );
  }
  if (host.execPath() !== raw.binary) {
    throw preconditionError(
      `A raw device updates the binary it runs from (${raw.binary}); run its own: ${raw.binary} sandbox update`,
    );
  }
  if (deviceVersion() === version) {
    logger.info(`The sandbox device already runs Tale ${version}.`);
    if (options.fromDevice) {
      await writeUpdateStatus(config.stateDir, {
        state: 'idle',
        targetVersion: version,
        error: null,
      });
    }
    return;
  }
  await writeUpdateStatus(config.stateDir, {
    state: 'updating',
    targetVersion: version,
    error: null,
  });
  try {
    const { release } = await resolveRelease({ version });
    const handle = await installBinary(release, { requireChecksum: true });
    try {
      await restartService(raw.service, host);
    } catch (err) {
      await rollbackInstall(handle);
      throw err;
    }
    await commitInstall(handle);
    await writeUpdateStatus(config.stateDir, {
      state: 'idle',
      targetVersion: version,
      error: null,
    });
    logger.success(`The sandbox device runs Tale ${version}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeUpdateStatus(config.stateDir, {
      state: 'failed',
      targetVersion: version,
      error: message.slice(0, 500),
    });
    throw new CliError({
      summary: `Updating the sandbox device to ${version} failed`,
      cause: err instanceof Error ? err : message,
    });
  }
}

// ── Status, logs, disconnect ────────────────────────────────────────────

export interface RawStatus {
  service: RawServiceKind;
  running: boolean | null;
  sessions: number;
  update: Awaited<ReturnType<typeof readUpdateStatus>>;
}

/** Whether the device's service runs, and how many sessions it holds. */
export async function rawStatus(
  config: SandboxDeviceConfig,
  host: RawHost = realHost,
): Promise<RawStatus> {
  const raw = config.raw;
  if (raw === undefined) throw new Error('not a raw device');
  let running: boolean | null = null;
  if (raw.service === 'systemd-system' || raw.service === 'systemd-user') {
    const result = await host.run([
      'systemctl',
      ...(raw.service === 'systemd-user' ? ['--user'] : []),
      'is-active',
      'tale-sandbox-device.service',
    ]);
    running = result.stdout.trim() === 'active';
  } else if (
    raw.service === 'launchd-daemon' ||
    raw.service === 'launchd-agent'
  ) {
    const domain =
      raw.service === 'launchd-daemon' ? 'system' : `gui/${host.uid()}`;
    const result = await host.run([
      'launchctl',
      'print',
      `${domain}/dev.tale.sandbox-device`,
    ]);
    running = result.code === 0 && /state = running/.test(result.stdout);
  }
  let sessions = 0;
  try {
    const records = await readdir(join(raw.root, 'control'));
    for (const name of records) {
      if (!name.endsWith('.json')) continue;
      try {
        const record: unknown = JSON.parse(
          await readFile(join(raw.root, 'control', name), 'utf8'),
        );
        if (
          record !== null &&
          typeof record === 'object' &&
          Reflect.get(record, 'runnerd') !== null
        )
          sessions += 1;
      } catch (err) {
        logger.debug(
          `unreadable session record ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    logger.debug(
      `no session records: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return {
    service: raw.service,
    running,
    sessions,
    update: await readUpdateStatus(config.stateDir),
  };
}

export async function rawLogs(
  config: SandboxDeviceConfig,
  options: { follow: boolean; tail: number },
): Promise<number> {
  const raw = config.raw;
  if (raw === undefined) throw new Error('not a raw device');
  if (raw.service === 'none') {
    logger.info(
      "This device's service is run by whoever manages the machine; read its log there.",
    );
    return 0;
  }
  const argv = logCommand(raw.service, config.stateDir, options);
  const proc = Bun.spawn(argv, { stdout: 'inherit', stderr: 'inherit' });
  return await proc.exited;
}

/** Stop the device and everything it runs, and take its files away (or keep
 * the workspaces). Every session's processes end with its runnerd's account
 * (isolated) or its process tree (shared). */
export async function removeRawDevice(
  config: SandboxDeviceConfig,
  options: { keepData: boolean },
  host: RawHost = realHost,
): Promise<void> {
  const raw = config.raw;
  if (raw === undefined) throw new Error('not a raw device');
  await removeService(raw.service, host);
  if (raw.isolation === 'isolated') {
    for (const slot of raw.slots) {
      // Every process of the account goes, the sessions' runnerds included.
      await host.run(['pkill', '-KILL', '-u', String(slot.uid)]);
    }
  } else {
    await endSharedSessions(raw.root, host);
  }
  if (raw.madeSlots) await removeSlotAccounts(host, raw.slots);
  if (options.keepData) {
    await rm(sandboxDeviceConfigPath(config.stateDir), { force: true });
    for (const dir of ['control', 'lib', 'bin', 'slots']) {
      await rm(join(raw.root, dir), { recursive: true, force: true });
    }
    return;
  }
  await rm(raw.root, { recursive: true, force: true });
}

/** A shared device's sessions: each runnerd the records name, and its tree. */
async function endSharedSessions(root: string, host: RawHost): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(join(root, 'control'));
  } catch (err) {
    logger.debug(
      `no session records: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record: unknown = JSON.parse(
        await readFile(join(root, 'control', name), 'utf8'),
      );
      const runnerd =
        record !== null && typeof record === 'object'
          ? Reflect.get(record, 'runnerd')
          : null;
      const pid =
        runnerd !== null && typeof runnerd === 'object'
          ? Reflect.get(runnerd, 'pid')
          : null;
      if (typeof pid === 'number' && Number.isInteger(pid) && pid > 1) {
        // runnerd ends its execs on SIGTERM; their groups go with it.
        await host.run(['pkill', '-TERM', '-P', String(pid)]);
        await host.run(['kill', '-TERM', String(pid)]);
      }
    } catch (err) {
      logger.debug(
        `unreadable session record ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

declare const TALE_COMPILED: boolean | undefined;

/** Refuse a raw connect from a development run (`bun src/index.ts`): a raw
 * device runs from, and copies, the compiled `tale` binary. */
export function assertCompiledCli(): void {
  if (typeof TALE_COMPILED === 'undefined' || !TALE_COMPILED) {
    throw preconditionError(
      'A raw device runs from the compiled `tale` binary, not from a development checkout.',
      [
        'Install the CLI (https://docs.tale.dev/self-hosted/install/cli-install) and run it from there.',
      ],
    );
  }
}

export async function readRawConfig(
  home: string,
): Promise<SandboxDeviceConfig | null> {
  return await readSandboxDeviceConfig(sandboxDeviceConfigPath(home));
}

export { systemPath };
