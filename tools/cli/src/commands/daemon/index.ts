import path from 'node:path';
import { createInterface } from 'node:readline/promises';

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

async function setup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('tale daemon setup\n');
    const baseUrl =
      (await rl.question('Tale base URL (e.g. https://your-org.tale.dev): '))
        .trim()
        .replace(/\/$/, '') || 'http://localhost:3000';
    const apiKey = (
      await rl.question(
        'API key (Settings → API → create key; leave empty to use TALE_DAEMON_API_KEY): ',
      )
    ).trim();
    const name =
      (
        await rl.question(
          'Daemon name (shown in Tale, e.g. "macbook-yannick"): ',
        )
      ).trim() || undefined;
    const workspacePath = (
      await rl.question('Workspace path (a git repo agents may work in): ')
    ).trim();
    const workspaceKey = workspacePath
      ? (
          await rl.question(
            `Workspace key to advertise for it [${path.basename(workspacePath)}]: `,
          )
        ).trim() || path.basename(workspacePath)
      : '';
    const ceiling = (
      await rl.question(
        'Permission ceiling — safe | auto_edits | full_auto [safe]: ',
      )
    ).trim();

    const config: DaemonConfig = {
      baseUrl,
      apiKey: apiKey || undefined,
      daemonId: newDaemonId(),
      name,
      workspaces: workspacePath ? { [workspaceKey]: workspacePath } : {},
      defaultWorkspace: workspaceKey || undefined,
      permissionCeiling:
        ceiling === 'auto_edits' || ceiling === 'full_auto' ? ceiling : 'safe',
    };
    saveConfig(config);
    console.log(`\nSaved ${configPath()} (key stored chmod 600).`);

    const detections = await detectAdapters();
    console.log(
      detections.length > 0
        ? `Detected CLIs: ${detections.map((d) => `${d.adapterType}${d.version ? ` (${d.version})` : ''}`).join(', ')}`
        : 'No supported CLIs found yet — install claude, codex, or opencode.',
    );
    console.log('\nNext: tale daemon start');
  } finally {
    rl.close();
  }
}

async function status(): Promise<void> {
  const config = loadConfig();
  console.log(`config:      ${configPath()}`);
  console.log(`daemonId:    ${config.daemonId}`);
  console.log(`baseUrl:     ${config.baseUrl}`);
  console.log(
    `workspaces:  ${Object.keys(config.workspaces).join(', ') || '(none)'}`,
  );
  console.log(`ceiling:     ${config.permissionCeiling}`);
  const detections = await detectAdapters();
  console.log(
    `adapters:    ${detections.map((d) => `${d.adapterType}${d.version ? ` (${d.version})` : ''}`).join(', ') || '(none found)'}`,
  );
  try {
    const api = new TaleApi(config);
    await api.heartbeat();
    console.log('server:      reachable (heartbeat ok)');
  } catch (error) {
    console.log(
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
    .action(async () => {
      try {
        await setup();
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  daemon
    .command('start')
    .description('Register and run the claim loop (Ctrl-C drains the run)')
    .action(async () => {
      try {
        await runDaemon(loadConfig());
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  daemon
    .command('status')
    .description('Show config, detected CLIs, and server connectivity')
    .action(async () => {
      try {
        await status();
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return daemon;
}
