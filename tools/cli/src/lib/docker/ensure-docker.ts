import * as logger from '../../utils/logger';
import { confirm } from '../../utils/prompt';
import { daemonReachable } from './daemon-reachable';
import { exec } from './exec';

/**
 * Zero-prerequisite Docker provisioning.
 *
 * Tale should install cleanly on a machine that has never seen Docker. This
 * module detects whether the Docker engine is usable and, when it isn't,
 * drives a per-OS install behind a single consent prompt. The *decision*
 * (which install strategies to attempt, in which order, given the tools that
 * happen to exist on the box) is a pure function — `planDockerInstall` — so
 * every clean-device branch is unit-testable without running an installer.
 * The side-effecting runners are thin wrappers the tests stub out.
 */

export type DockerPlatform = 'linux' | 'macos' | 'windows';

export type LinuxPackageManager = 'apt' | 'dnf' | 'pacman' | 'zypper';

/** What tooling the host already has — the inputs to the install decision. */
export interface DockerEnvProbe {
  platform: DockerPlatform;
  hasBrew: boolean;
  hasWinget: boolean;
  hasCurl: boolean;
  hasWget: boolean;
  hasWsl: boolean;
  packageManager: LinuxPackageManager | null;
}

export type InstallStrategyKind =
  | 'brew' // (install Homebrew first if absent) then `brew install --cask docker`
  | 'dmg' // download the official Docker.dmg, mount, copy to /Applications
  | 'winget' // `winget install -e --id Docker.DockerDesktop`
  | 'desktop-exe' // download the official Docker Desktop installer, run silently
  | 'get-docker' // curl/wget get.docker.com | sh (+ bootstrap a downloader first)
  | 'manual'; // no automated path — print guidance + docs link, never a dead end

interface InstallStrategy {
  kind: InstallStrategyKind;
  /** Short human label for the consent prompt / progress line. */
  label: string;
  /** Ordered sub-steps, for logging and for asserting branches in tests. */
  steps: string[];
}

interface DockerInstallPlan {
  platform: DockerPlatform;
  /**
   * Strategies attempted in order until the daemon is reachable. The last
   * entry is always `manual`, so there is never a dead end.
   */
  strategies: InstallStrategy[];
}

const DOCKER_DOCS_URL = 'https://docs.docker.com/get-docker/';

function manualStrategy(platform: DockerPlatform): InstallStrategy {
  return {
    kind: 'manual',
    label: 'Manual install',
    steps: [
      `Install Docker for ${platform} by following ${DOCKER_DOCS_URL}`,
      'Then re-run `tale start`.',
    ],
  };
}

function planMacos(probe: DockerEnvProbe): InstallStrategy[] {
  const brewSteps = probe.hasBrew
    ? ['brew install --cask docker']
    : [
        'Install Homebrew (https://brew.sh) via the official install script',
        'brew install --cask docker',
      ];
  return [
    {
      kind: 'brew',
      label: 'Homebrew',
      steps: [...brewSteps, 'Launch Docker Desktop and wait for the engine'],
    },
    {
      kind: 'dmg',
      label: 'Official Docker.dmg',
      steps: [
        'Download the official Docker.dmg',
        'Mount it and copy Docker.app to /Applications',
        'Launch Docker Desktop and wait for the engine',
      ],
    },
    manualStrategy('macos'),
  ];
}

function planWindows(probe: DockerEnvProbe): InstallStrategy[] {
  const wslStep = probe.hasWsl
    ? 'Confirm the WSL2 backend is available'
    : 'Enable the WSL2 backend (wsl --install; reboot if prompted)';
  const strategies: InstallStrategy[] = [];
  if (probe.hasWinget) {
    strategies.push({
      kind: 'winget',
      label: 'winget',
      steps: [
        wslStep,
        'winget install -e --id Docker.DockerDesktop',
        'Launch Docker Desktop and wait for the engine',
      ],
    });
  }
  strategies.push({
    kind: 'desktop-exe',
    label: 'Official Docker Desktop installer',
    steps: [
      wslStep,
      'Download the official Docker Desktop installer',
      'Run it silently (install --quiet)',
      'Launch Docker Desktop and wait for the engine',
    ],
  });
  strategies.push(manualStrategy('windows'));
  return strategies;
}

function planLinux(probe: DockerEnvProbe): InstallStrategy[] {
  const hasDownloader = probe.hasCurl || probe.hasWget;
  const canBootstrapDownloader =
    !hasDownloader && probe.packageManager !== null;
  const strategies: InstallStrategy[] = [];
  // get.docker.com needs curl or wget. If neither is present we can still
  // proceed when a package manager can install one first.
  if (hasDownloader || canBootstrapDownloader) {
    const steps: string[] = [];
    if (!hasDownloader && probe.packageManager) {
      steps.push(`Install curl via ${probe.packageManager}`);
    }
    steps.push(
      'curl -fsSL https://get.docker.com | sh',
      'Enable and start the Docker daemon (systemctl when present)',
      'Add the current user to the `docker` group',
    );
    strategies.push({ kind: 'get-docker', label: 'get.docker.com', steps });
  }
  strategies.push(manualStrategy('linux'));
  return strategies;
}

/**
 * Pure decision: given what the host already has, which install strategies
 * should be attempted and in what order. No side effects — safe to unit-test
 * across every clean-device combination.
 */
export function planDockerInstall(probe: DockerEnvProbe): DockerInstallPlan {
  let strategies: InstallStrategy[];
  switch (probe.platform) {
    case 'macos':
      strategies = planMacos(probe);
      break;
    case 'windows':
      strategies = planWindows(probe);
      break;
    case 'linux':
      strategies = planLinux(probe);
      break;
  }
  return { platform: probe.platform, strategies };
}

function currentDockerPlatform(): DockerPlatform | null {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return null;
  }
}

async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = await exec(probe, [command], { silent: true });
    return result.success && result.stdout.length > 0;
  } catch {
    // Bun.spawn throws ENOENT when `which`/`where` itself is missing.
    return false;
  }
}

async function detectLinuxPackageManager(): Promise<LinuxPackageManager | null> {
  const managers: [string, LinuxPackageManager][] = [
    ['apt-get', 'apt'],
    ['dnf', 'dnf'],
    ['pacman', 'pacman'],
    ['zypper', 'zypper'],
  ];
  for (const [binary, name] of managers) {
    if (await commandExists(binary)) return name;
  }
  return null;
}

/** Snapshot the host tooling. Side-effecting; stubbed in tests. */
async function probeDockerEnv(
  platform: DockerPlatform,
): Promise<DockerEnvProbe> {
  const [hasBrew, hasWinget, hasCurl, hasWget, hasWsl, packageManager] =
    await Promise.all([
      platform === 'macos' ? commandExists('brew') : Promise.resolve(false),
      platform === 'windows' ? commandExists('winget') : Promise.resolve(false),
      commandExists('curl'),
      commandExists('wget'),
      platform === 'windows' ? commandExists('wsl') : Promise.resolve(false),
      platform === 'linux'
        ? detectLinuxPackageManager()
        : Promise.resolve(null),
    ]);
  return {
    platform,
    hasBrew,
    hasWinget,
    hasCurl,
    hasWget,
    hasWsl,
    packageManager,
  };
}

interface DockerState {
  cliPresent: boolean;
  daemonReachable: boolean;
  detail: string;
}

/** Is Docker installed and is its engine answering? */
async function detectDockerState(): Promise<DockerState> {
  const cliPresent = await commandExists('docker');
  if (!cliPresent) {
    return {
      cliPresent: false,
      daemonReachable: false,
      detail: 'docker CLI not on PATH',
    };
  }
  const status = await daemonReachable();
  return {
    cliPresent: true,
    daemonReachable: status.reachable,
    detail: status.detail,
  };
}

const DAEMON_READY_TIMEOUT_MS = 120_000;
const DAEMON_POLL_INTERVAL_MS = 2_000;

/** Poll until the daemon answers or the timeout elapses. */
async function waitForDockerReady(
  timeoutMs = DAEMON_READY_TIMEOUT_MS,
  intervalMs = DAEMON_POLL_INTERVAL_MS,
  now: () => number = () => Date.now(),
): Promise<boolean> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const status = await daemonReachable();
    if (status.reachable) return true;
    if (now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

interface EnsureDockerOptions {
  /** Skip the consent prompt (e.g. `--yes`, CI). */
  assumeYes?: boolean;
  /** Whether a TTY is attached. Defaults to the real stdin/stdout. */
  interactive?: boolean;
}

interface EnsureDockerResult {
  status: 'ready' | 'installed' | 'refused' | 'failed';
  detail: string;
}

function isInteractive(opts: EnsureDockerOptions): boolean {
  if (opts.interactive !== undefined) return opts.interactive;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Run a single strategy. Returns true when, after running, the daemon is
 * reachable. Strategy runners intentionally fail soft (return false / throw)
 * so the orchestrator can fall through to the next strategy.
 */
async function runStrategy(strategy: InstallStrategy): Promise<boolean> {
  if (strategy.kind === 'manual') {
    logger.notice('Automatic install was not possible. Finish manually:');
    for (const line of strategy.steps) logger.info(`  • ${line}`);
    return false;
  }

  logger.step(`Installing Docker via ${strategy.label}…`);
  for (const line of strategy.steps) logger.info(`  • ${line}`);

  switch (strategy.kind) {
    case 'brew':
      await runBrewInstall();
      break;
    case 'dmg':
      await runDmgInstall();
      break;
    case 'winget':
      await runWingetInstall();
      break;
    case 'desktop-exe':
      await runDesktopExeInstall();
      break;
    case 'get-docker':
      await runGetDockerScript();
      break;
  }

  logger.step('Waiting for the Docker engine to start…');
  return waitForDockerReady();
}

async function runBrewInstall(): Promise<void> {
  if (!(await commandExists('brew'))) {
    await exec('/bin/bash', [
      '-c',
      'curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash',
    ]);
  }
  await exec('brew', ['install', '--cask', 'docker']);
  await launchDockerDesktopMac();
}

async function runDmgInstall(): Promise<void> {
  // Drive the official disk image without Homebrew. Match the disk image to
  // the host CPU: the arm64 image won't launch on an Intel Mac (and vice
  // versa), so hardcoding one arch turns the dmg fallback into a ~2-minute
  // dead end (a download + a daemon-ready timeout) on the other.
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  await exec('/bin/bash', [
    '-c',
    [
      'set -e',
      'dmg="$(mktemp -t Docker).dmg"',
      `curl -fsSL https://desktop.docker.com/mac/main/${arch}/Docker.dmg -o "$dmg"`,
      'hdiutil attach "$dmg" -nobrowse -quiet',
      'cp -R /Volumes/Docker/Docker.app /Applications/',
      'hdiutil detach /Volumes/Docker -quiet',
      'rm -f "$dmg"',
    ].join('\n'),
  ]);
  await launchDockerDesktopMac();
}

async function launchDockerDesktopMac(): Promise<void> {
  await exec('open', ['-a', 'Docker']);
}

/**
 * Start Docker Desktop on Windows without blocking on the GUI process. The
 * daemon comes up asynchronously and `waitForDockerReady` polls for it. Fail
 * soft: a missing install path just means the readiness poll times out and the
 * orchestrator falls through — the parallel of macOS's `open -a Docker`, but
 * Windows had no launch step at all, so a fresh `winget`/exe install installed
 * Docker yet never started the engine and dead-ended at the daemon timeout.
 */
async function launchDockerDesktopWindows(): Promise<void> {
  try {
    await exec('powershell', [
      '-NoProfile',
      '-Command',
      'Start-Process -FilePath "$env:ProgramFiles\\Docker\\Docker\\Docker Desktop.exe"',
    ]);
  } catch (err) {
    logger.warn(
      `Could not auto-start Docker Desktop: ${err instanceof Error ? err.message : String(err)}. ` +
        'Start it from the Start menu, then re-run.',
    );
  }
}

async function runWingetInstall(): Promise<void> {
  await exec('winget', [
    'install',
    '-e',
    '--id',
    'Docker.DockerDesktop',
    '--accept-source-agreements',
    '--accept-package-agreements',
  ]);
  await launchDockerDesktopWindows();
}

async function runDesktopExeInstall(): Promise<void> {
  await exec('powershell', [
    '-NoProfile',
    '-Command',
    [
      '$ErrorActionPreference = "Stop"',
      '$exe = Join-Path $env:TEMP "DockerDesktopInstaller.exe"',
      'Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker Desktop Installer.exe" -OutFile $exe',
      'Start-Process -FilePath $exe -ArgumentList "install","--quiet" -Wait',
    ].join('; '),
  ]);
  await launchDockerDesktopWindows();
}

async function runGetDockerScript(): Promise<void> {
  // The Linux plan accepts a wget-only host (and may bootstrap a downloader),
  // so honor whichever fetcher is present rather than hardcoding curl.
  await exec('/bin/sh', [
    '-c',
    'if command -v curl >/dev/null 2>&1; then curl -fsSL https://get.docker.com | sh; ' +
      'else wget -qO- https://get.docker.com | sh; fi',
  ]);
  // Best-effort daemon start on systemd hosts; ignored where systemctl is absent.
  if (await commandExists('systemctl')) {
    await exec('sudo', ['systemctl', 'enable', '--now', 'docker']);
  }
}

/**
 * Ensure the Docker engine is usable, installing it if necessary.
 *
 * Short-circuits when the daemon already answers. When the CLI is present but
 * the daemon is down, attempts to start it. When Docker is missing entirely,
 * prompts once for consent (or refuses on a non-TTY) and runs the per-OS
 * install plan, attempting each strategy until the daemon answers.
 */
export async function ensureDocker(
  opts: EnsureDockerOptions = {},
): Promise<EnsureDockerResult> {
  const state = await detectDockerState();
  if (state.daemonReachable) {
    return { status: 'ready', detail: state.detail };
  }

  const platform = currentDockerPlatform();
  if (platform === null) {
    return {
      status: 'failed',
      detail: `Unsupported platform: ${process.platform}`,
    };
  }

  // CLI present, daemon down: try to wake it rather than reinstall.
  if (state.cliPresent) {
    logger.step(
      'Docker is installed but its engine is not responding — starting it...',
    );
    if (platform === 'macos') await launchDockerDesktopMac();
    else if (platform === 'windows') await launchDockerDesktopWindows();
    else if (platform === 'linux' && (await commandExists('systemctl'))) {
      await exec('sudo', ['systemctl', 'start', 'docker']);
    }
    if (await waitForDockerReady(60_000)) {
      return { status: 'ready', detail: 'engine started' };
    }
    return {
      status: 'failed',
      detail:
        'Docker is installed but the engine did not start. Start Docker manually and re-run.',
    };
  }

  // Docker is missing entirely — install it.
  const interactive = isInteractive(opts);
  if (!interactive && !opts.assumeYes) {
    return {
      status: 'refused',
      detail:
        'Docker is not installed and this is a non-interactive shell. Re-run with --yes to allow the CLI to install Docker, or install it from ' +
        DOCKER_DOCS_URL,
    };
  }

  if (!opts.assumeYes) {
    logger.notice('Docker is required and was not found on this machine.');
    const consent = await confirm({
      message:
        'Install Docker now? (this may request your password for a privileged step)',
      default: true,
    });
    if (!consent) {
      return {
        status: 'refused',
        detail: `Skipped Docker install. Install it yourself from ${DOCKER_DOCS_URL}, then re-run \`tale start\`.`,
      };
    }
  }

  const probe = await probeDockerEnv(platform);
  const plan = planDockerInstall(probe);

  for (const strategy of plan.strategies) {
    try {
      if (await runStrategy(strategy)) {
        logger.success('Docker is installed and the engine is running.');
        return {
          status: 'installed',
          detail: `installed via ${strategy.kind}`,
        };
      }
    } catch (err) {
      logger.warn(
        `Docker install via ${strategy.kind} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Fall through to the next strategy (the last is always `manual`).
    }
  }

  return {
    status: 'failed',
    detail: `Could not install Docker automatically. See ${DOCKER_DOCS_URL}.`,
  };
}
