#!/usr/bin/env bun
/**
 * tale-daemon — run Tale task work on your local coding-agent CLIs.
 *
 *   tale-daemon setup    interactive: base URL, API key, workspaces
 *   tale-daemon start    register + claim loop (Ctrl-C drains the run)
 *   tale-daemon status   show config, detected CLIs, connectivity
 *
 * Works under Bun (`bunx tale-daemon …`) and any Node ≥ 20 with a TS
 * loader; only `node:*` APIs and global fetch are used.
 */

import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { detectAdapters } from './adapters/index.ts';
import { TaleApi } from './api.ts';
import {
  configPath,
  loadConfig,
  newDaemonId,
  saveConfig,
  type DaemonConfig,
} from './config.ts';
import { runDaemon } from './daemon.ts';

async function setup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('tale-daemon setup\n');
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
    console.log('\nNext: tale-daemon start');
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

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start';
  switch (command) {
    case 'setup':
      await setup();
      return;
    case 'status':
      await status();
      return;
    case 'start': {
      const config = loadConfig();
      await runDaemon(config);
      return;
    }
    default:
      console.error(
        `Unknown command "${command}". Use: setup | start | status`,
      );
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    `[tale-daemon] fatal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
