import path from 'node:path';

import { Command } from 'commander';

import { detectAdapters } from '../../daemon/adapters/index';
import { TaleApi } from '../../daemon/api';
import {
  buildDaemonConfig,
  configPath,
  isPermissionMode,
  loadConfig,
  saveConfig,
  type DaemonConfig,
  type DaemonSetupInput,
} from '../../daemon/config';
import { runDaemon } from '../../daemon/daemon';
import { usageError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { input, select } from '../../utils/prompt';
import { action } from '../../utils/run-command';

/**
 * Raw `--flag` values from `commander`. When every prompt is supplied a value
 * — as the Runtimes settings page does with its `--url`/`--key` command —
 * setup runs unattended; missing values fall back to interactive prompts (or
 * their defaults under `--yes`). `--ceiling` is validated up front so a typo
 * fails loudly instead of silently downgrading to `safe`.
 */
interface SetupFlags {
  url?: string;
  key?: string;
  name?: string;
  workspace?: string;
  workspaceKey?: string;
  ceiling?: string;
}

function parseCeiling(
  value: string | undefined,
): DaemonConfig['permissionCeiling'] | undefined {
  if (value === undefined) return undefined;
  if (!isPermissionMode(value)) {
    throw usageError(
      `Invalid --ceiling "${value}" — use safe, auto_edits, or full_auto.`,
    );
  }
  return value;
}

async function setup(flags: SetupFlags): Promise<void> {
  logger.info('Configuring the Tale daemon for this machine.');

  const baseUrl =
    flags.url ??
    (await input({
      message: 'Tale base URL (e.g. https://your-org.tale.dev):',
      default: 'http://localhost:3000',
    }));
  const apiKey =
    flags.key ??
    (await input({
      message:
        'API key (Settings → API → create key; leave empty to use TALE_DAEMON_API_KEY):',
      default: '',
    }));
  const name =
    flags.name ??
    (await input({
      message: 'Daemon name (shown in Tale, e.g. "macbook-yannick"):',
      default: '',
    }));
  const workspacePath =
    flags.workspace ??
    (await input({
      message: 'Workspace path (a git repo agents may work in):',
      default: '',
    }));
  const workspaceKey =
    flags.workspaceKey ??
    (workspacePath.trim()
      ? await input({
          message: 'Workspace key to advertise for it:',
          default: path.basename(workspacePath.trim()),
        })
      : '');
  const permissionCeiling =
    parseCeiling(flags.ceiling) ??
    (await select<DaemonConfig['permissionCeiling']>({
      message: 'Permission ceiling',
      default: 'safe',
      choices: [
        { name: 'safe', value: 'safe', description: 'Read-only; no edits' },
        {
          name: 'auto_edits',
          value: 'auto_edits',
          description: 'Edits allowed without per-step approval',
        },
        {
          name: 'full_auto',
          value: 'full_auto',
          description: 'Fully autonomous (highest trust)',
        },
      ],
    }));

  const setupInput: DaemonSetupInput = {
    baseUrl,
    apiKey,
    name,
    workspacePath,
    workspaceKey,
    permissionCeiling,
  };
  const config = buildDaemonConfig(setupInput);
  saveConfig(config);
  logger.success(`Saved ${configPath()} (key stored chmod 600).`);

  const detections = await detectAdapters();
  logger.info(
    detections.length > 0
      ? `Detected CLIs: ${detections.map((d) => `${d.adapterType}${d.version ? ` (${d.version})` : ''}`).join(', ')}`
      : 'No supported CLIs found yet — install claude, codex, or opencode.',
  );
  logger.info('Next: tale daemon start');
}

async function status(): Promise<void> {
  const config = loadConfig();
  logger.info(`config:      ${configPath()}`);
  logger.info(`daemonId:    ${config.daemonId}`);
  logger.info(`baseUrl:     ${config.baseUrl}`);
  logger.info(
    `workspaces:  ${Object.keys(config.workspaces).join(', ') || '(none)'}`,
  );
  logger.info(`ceiling:     ${config.permissionCeiling}`);
  const detections = await detectAdapters();
  logger.info(
    `adapters:    ${detections.map((d) => `${d.adapterType}${d.version ? ` (${d.version})` : ''}`).join(', ') || '(none found)'}`,
  );
  try {
    const api = new TaleApi(config);
    await api.heartbeat();
    logger.success('server:      reachable (heartbeat ok)');
  } catch (error) {
    logger.warn(
      `server:      UNREACHABLE — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * `tale daemon` — run Tale board tasks on this machine with your local
 * coding-agent CLIs. Agents bound to an external runtime get their tasks
 * dispatched here instead of Tale's internal LLM loop; each run executes in an
 * isolated git worktree and reports back. Nothing is ever pushed.
 */
export function createDaemonCommand(): Command {
  const daemon = new Command('daemon').description(
    'Run Tale task work on this machine via your local coding-agent CLIs',
  );

  daemon.addHelpText(
    'after',
    `
Runs board tasks for agents bound to an external runtime, using the coding-agent
CLIs already on your PATH (Claude Code, Codex, OpenCode). Each run executes in an
isolated git worktree and reports back — nothing is ever pushed. The effective
permission is min(server-configured, local ceiling); 'safe' by default.

  tale daemon setup    Configure base URL, API key, workspace, permission ceiling
  tale daemon start    Register + claim loop (Ctrl-C drains the current run)
  tale daemon status   Show config, detected CLIs, server connectivity

Any setup answer can be passed as a flag to skip its prompt; add --yes to run
fully unattended (this is what the "generate & copy" button in Settings → API →
Runtimes embeds):

  tale daemon setup --yes --url https://your-org.tale.dev --key <api-key>

Config lives at ~/.tale-daemon/config.json (chmod 600). Set TALE_DAEMON_API_KEY
to keep the key out of the file; TALE_DAEMON_HOME overrides the config dir.
`,
  );

  daemon
    .command('setup')
    .description(
      'Configure base URL, API key, workspace, permission ceiling (flags skip prompts)',
    )
    .option('--url <url>', 'Tale base URL (skips the prompt)')
    .option('--key <key>', 'API key for this daemon (skips the prompt)')
    .option('--name <name>', 'Daemon name shown in Tale (skips the prompt)')
    .option('--workspace <path>', 'Local git workspace path (skips the prompt)')
    .option(
      '--workspace-key <key>',
      'Advertised workspace key (skips the prompt)',
    )
    .option(
      '--ceiling <mode>',
      'Permission ceiling: safe | auto_edits | full_auto (skips the prompt)',
    )
    .action(
      action(async (flags: SetupFlags) => {
        await setup(flags);
      }),
    );

  daemon
    .command('start')
    .description('Register and run the claim loop (Ctrl-C drains the run)')
    .action(
      action(async () => {
        await runDaemon(loadConfig());
      }),
    );

  daemon
    .command('status')
    .description('Show config, detected CLIs, and server connectivity')
    .action(
      action(async () => {
        await status();
      }),
    );

  return daemon;
}
