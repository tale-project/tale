import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { isRecord, type PermissionMode } from './adapters/types';

/**
 * Daemon configuration at `~/.tale-daemon/config.json` (chmod 600 — it
 * holds the API key; set `TALE_DAEMON_API_KEY` instead to keep the key out
 * of the file entirely). `daemonId` is generated once at setup and is the
 * stable identity the server pins runs and leases to.
 *
 * `workspaces` maps the ADVERTISED keys to local paths — the paths never
 * leave this machine. `permissionCeiling` is the daemon-local maximum; the
 * effective mode of a run is min(server-requested, this), so `full_auto`
 * requires opting in on BOTH sides.
 */
export interface DaemonConfig {
  baseUrl: string;
  apiKey?: string;
  daemonId: string;
  name?: string;
  workspaces: Record<string, string>;
  defaultWorkspace?: string;
  permissionCeiling: PermissionMode;
}

function configDir(): string {
  return process.env.TALE_DAEMON_HOME ?? path.join(homedir(), '.tale-daemon');
}

export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export function newDaemonId(): string {
  return `daemon_${randomUUID()}`;
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'safe' || value === 'auto_edits' || value === 'full_auto';
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'string') out[key] = val;
  }
  return out;
}

export function loadConfig(): DaemonConfig {
  const raw = readFileSync(configPath(), 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`Malformed config at ${configPath()}`);
  }
  const config = parsed;
  const { baseUrl, daemonId } = config;
  if (typeof baseUrl !== 'string' || typeof daemonId !== 'string') {
    throw new Error(
      `Config at ${configPath()} is missing baseUrl/daemonId — run \`tale daemon setup\`.`,
    );
  }
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey : undefined;
  const name = typeof config.name === 'string' ? config.name : undefined;
  const defaultWorkspace =
    typeof config.defaultWorkspace === 'string'
      ? config.defaultWorkspace
      : undefined;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey: process.env.TALE_DAEMON_API_KEY ?? apiKey,
    daemonId,
    name,
    workspaces: asStringRecord(config.workspaces),
    defaultWorkspace,
    permissionCeiling: isPermissionMode(config.permissionCeiling)
      ? config.permissionCeiling
      : 'safe',
  };
}

export function saveConfig(config: DaemonConfig): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** Effective permission = min(server request, daemon ceiling). */
const PERMISSION_RANK: Record<PermissionMode, number> = {
  safe: 0,
  auto_edits: 1,
  full_auto: 2,
};

export function effectivePermission(
  requested: PermissionMode,
  ceiling: PermissionMode,
): PermissionMode {
  return PERMISSION_RANK[requested] <= PERMISSION_RANK[ceiling]
    ? requested
    : ceiling;
}
