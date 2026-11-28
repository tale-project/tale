import { mkdir, rm, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';

import { must, type RawHost } from './host';

// A raw device runs on Linux or macOS: its service definitions name POSIX
// paths wherever this module runs.
const { dirname, join } = posix;

/**
 * The service that keeps a raw device running: `tale sandbox device run`
 * under the machine's own service manager, restarted when it stops. An
 * isolated device (root) is a system service; a shared one runs as the user
 * who connected it. `none`: the caller runs the device itself (hostkit, which
 * renders its own unit with the same command).
 *
 * The device's sessions are processes of their own (one runnerd each) that
 * must outlive a restart of the service, which re-adopts them: systemd stops
 * only the device's own process (`KillMode=process`), and launchd leaves the
 * process groups the device started alone (`AbandonProcessGroup`).
 */
export type RawServiceKind =
  | 'systemd-system'
  | 'systemd-user'
  | 'launchd-daemon'
  | 'launchd-agent'
  | 'none';

const SYSTEMD_UNIT = 'tale-sandbox-device.service';
const LAUNCHD_LABEL = 'dev.tale.sandbox-device';

export interface RawServiceSpec {
  kind: RawServiceKind;
  /** The `tale` binary the service runs. */
  binary: string;
  configPath: string;
  /** The device's state directory (TALE_SANDBOX_HOME). */
  stateDir: string;
}

/** The service a device of this isolation on this system gets. */
export function serviceKindFor(
  os: NodeJS.Platform,
  isolation: 'isolated' | 'shared',
): RawServiceKind {
  if (os === 'darwin') {
    return isolation === 'isolated' ? 'launchd-daemon' : 'launchd-agent';
  }
  return isolation === 'isolated' ? 'systemd-system' : 'systemd-user';
}

function command(spec: RawServiceSpec): string[] {
  return [spec.binary, 'sandbox', 'device', 'run', '--config', spec.configPath];
}

/** systemd quotes an argument holding a space or a quote in double quotes. */
function systemdWord(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word)
    ? word
    : `"${word.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function renderSystemdUnit(spec: RawServiceSpec): string {
  const system = spec.kind === 'systemd-system';
  return [
    '[Unit]',
    'Description=Tale sandbox device (sessions run on this machine)',
    'Documentation=https://docs.tale.dev/platform/admin/sandbox-devices',
    ...(system
      ? ['Wants=network-online.target', 'After=network-online.target']
      : []),
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${command(spec).map(systemdWord).join(' ')}`,
    `Environment=${systemdWord(`TALE_SANDBOX_HOME=${spec.stateDir}`)}`,
    'Restart=always',
    'RestartSec=5',
    // The sessions are the device's children only until it restarts: they
    // run on, and the next start adopts them.
    'KillMode=process',
    'TimeoutStopSec=30',
    '',
    '[Install]',
    `WantedBy=${system ? 'multi-user.target' : 'default.target'}`,
    '',
  ].join('\n');
}

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderLaunchdPlist(spec: RawServiceSpec): string {
  const log = join(spec.stateDir, 'logs', 'device.log');
  const args = command(spec)
    .map((arg) => `    <string>${xml(arg)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TALE_SANDBOX_HOME</key>
    <string>${xml(spec.stateDir)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

/** Where the service's definition lives. */
export function servicePath(kind: RawServiceKind, home: string): string | null {
  switch (kind) {
    case 'systemd-system':
      return `/etc/systemd/system/${SYSTEMD_UNIT}`;
    case 'systemd-user':
      return join(home, '.config', 'systemd', 'user', SYSTEMD_UNIT);
    case 'launchd-daemon':
      return `/Library/LaunchDaemons/${LAUNCHD_LABEL}.plist`;
    case 'launchd-agent':
      return join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
    case 'none':
      return null;
  }
}

function launchdDomain(kind: RawServiceKind, host: RawHost): string {
  return kind === 'launchd-daemon' ? 'system' : `gui/${host.uid()}`;
}

function systemctl(kind: RawServiceKind, ...args: string[]): string[] {
  return kind === 'systemd-user'
    ? ['systemctl', '--user', ...args]
    : ['systemctl', ...args];
}

/** Write the service's definition and start it (again, when it ran). */
export async function installService(
  spec: RawServiceSpec,
  host: RawHost,
): Promise<void> {
  const path = servicePath(spec.kind, host.home());
  if (path === null) return;
  await mkdir(dirname(path), { recursive: true });
  await mkdir(join(spec.stateDir, 'logs'), { recursive: true, mode: 0o700 });
  if (spec.kind === 'systemd-system' || spec.kind === 'systemd-user') {
    await writeFile(path, renderSystemdUnit(spec), { mode: 0o644 });
    await must(host, systemctl(spec.kind, 'daemon-reload'), 'systemd reload');
    await must(
      host,
      systemctl(spec.kind, 'enable', '--now', SYSTEMD_UNIT),
      'starting the device service',
    );
    await must(
      host,
      systemctl(spec.kind, 'restart', SYSTEMD_UNIT),
      'starting the device service',
    );
    if (spec.kind === 'systemd-user') {
      // A user service stops when its user's last session ends, unless the
      // user lingers.
      const linger = await host.run(['loginctl', 'enable-linger', host.user()]);
      if (linger.code !== 0) {
        console.warn(
          `[tale] could not keep the device running after you log out (loginctl enable-linger ${host.user()}: ${linger.stderr.trim()}); ask an administrator to run it`,
        );
      }
    }
    return;
  }
  await writeFile(path, renderLaunchdPlist(spec), { mode: 0o644 });
  const domain = launchdDomain(spec.kind, host);
  // Booted out first, so a changed definition is the one that runs.
  await host.run(['launchctl', 'bootout', `${domain}/${LAUNCHD_LABEL}`]);
  await must(
    host,
    ['launchctl', 'bootstrap', domain, path],
    'starting the device service',
  );
}

/** Start the service again, from the binary that is now in place. */
export async function restartService(
  kind: RawServiceKind,
  host: RawHost,
): Promise<void> {
  if (kind === 'none') return;
  if (kind === 'systemd-system' || kind === 'systemd-user') {
    await must(
      host,
      systemctl(kind, 'restart', SYSTEMD_UNIT),
      'restarting the device service',
    );
    return;
  }
  await must(
    host,
    [
      'launchctl',
      'kickstart',
      '-k',
      `${launchdDomain(kind, host)}/${LAUNCHD_LABEL}`,
    ],
    'restarting the device service',
  );
}

/** Stop the service and remove its definition. */
export async function removeService(
  kind: RawServiceKind,
  host: RawHost,
): Promise<void> {
  const path = servicePath(kind, host.home());
  if (path === null) return;
  if (kind === 'systemd-system' || kind === 'systemd-user') {
    await host.run(systemctl(kind, 'disable', '--now', SYSTEMD_UNIT));
    await rm(path, { force: true });
    await host.run(systemctl(kind, 'daemon-reload'));
    return;
  }
  await host.run([
    'launchctl',
    'bootout',
    `${launchdDomain(kind, host)}/${LAUNCHD_LABEL}`,
  ]);
  await rm(path, { force: true });
}

/** The device's log, as its service manager keeps it. */
export function logCommand(
  kind: RawServiceKind,
  stateDir: string,
  options: { follow: boolean; tail: number },
): string[] {
  if (kind === 'systemd-system' || kind === 'systemd-user') {
    return [
      'journalctl',
      ...(kind === 'systemd-user' ? ['--user'] : []),
      '-u',
      SYSTEMD_UNIT,
      '-n',
      String(options.tail),
      '--no-pager',
      ...(options.follow ? ['-f'] : []),
    ];
  }
  return [
    'tail',
    '-n',
    String(options.tail),
    ...(options.follow ? ['-f'] : []),
    join(stateDir, 'logs', 'device.log'),
  ];
}
