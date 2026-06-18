import path from 'node:path';

import { Command } from 'commander';

import { detectAdapters } from '../../daemon/adapters/index';
import { TaleApi } from '../../daemon/api';
import {
  configPath,
  loadConfig,
  newDaemonId,
  saveConfig,
  type DaemonConfig,
} from '../../daemon/config';
import { runDaemon } from '../../daemon/daemon';
import * as logger from '../../utils/logger';
import { input, select } from '../../utils/prompt';
import { action } from '../../utils/run-command';

async function setup(): Promise<void> {
  logger.info('Configuring the Tale daemon for this machine.');

  const baseUrl =
    (
      await input({
        message: 'Tale base URL (e.g. https://your-org.tale.dev):',
        default: 'http://localhost:3000',
      })
    )
      .trim()
      .replace(/\/$/, '') || 'http://localhost:3000';
  const apiKey = (
    await input({
      message:
        'API key (Settings → API → create key; leave empty to use TALE_DAEMON_API_KEY):',
    })
  ).trim();
  const name =
    (
      await input({
        message: 'Daemon name (shown in Tale, e.g. "macbook-yannick"):',
      })
    ).trim() || undefined;
  const workspacePath = (
    await input({
      message: 'Workspace path (a git repo agents may work in):',
    })
  ).trim();
  const workspaceKey = workspacePath
    ? (
        await input({
          message: 'Workspace key to advertise for it:',
          default: path.basename(workspacePath),
        })
      ).trim() || path.basename(workspacePath)
    : '';
  const permissionCeiling = await select<DaemonConfig['permissionCeiling']>({
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
  });

  const config: DaemonConfig = {
    baseUrl,
    apiKey: apiKey || undefined,
    daemonId: newDaemonId(),
    name,
    workspaces: workspacePath ? { [workspaceKey]: workspacePath } : {},
    defaultWorkspace: workspaceKey || undefined,
    permissionCeiling,
  };
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

Config lives at ~/.tale-daemon/config.json (chmod 600). Set TALE_DAEMON_API_KEY
to keep the key out of the file; TALE_DAEMON_HOME overrides the config dir.
`,
  );

  daemon
    .command('setup')
    .description(
      'Interactive: base URL, API key, workspace, permission ceiling',
    )
    .action(
      action(async () => {
        await setup();
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
