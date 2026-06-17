/**
 * Workspace handling: every run executes in its OWN git worktree on a
 * dedicated branch, so retried attempts never see a dirty tree and parallel
 * runs can't trample each other. Non-git workspaces fall back to running
 * in place (no isolation, no diff stat) with a warning.
 */

import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DaemonConfig } from './config';

const execFileAsync = promisify(execFile);

interface RunWorkspace {
  /** Directory the CLI executes in. */
  cwd: string;
  branchName?: string;
  isWorktree: boolean;
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; ok: boolean }> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 30_000,
    });
    return { stdout, ok: true };
  } catch (error) {
    console.warn(`[tale-daemon] git ${args[0]} failed:`, error);
    return { stdout: '', ok: false };
  }
}

export function resolveWorkspacePath(
  config: DaemonConfig,
  workspaceKey: string | undefined,
): string | null {
  if (workspaceKey) return config.workspaces[workspaceKey] ?? null;
  if (config.defaultWorkspace) {
    return (
      config.workspaces[config.defaultWorkspace] ?? config.defaultWorkspace
    );
  }
  const first = Object.values(config.workspaces)[0];
  return first ?? null;
}

export async function prepareWorkspace(
  basePath: string,
  externalRunId: string,
): Promise<RunWorkspace> {
  const inGit = await git(basePath, ['rev-parse', '--is-inside-work-tree']);
  if (!inGit.ok || !inGit.stdout.trim().startsWith('true')) {
    console.warn(
      `[tale-daemon] ${basePath} is not a git repository — running WITHOUT worktree isolation.`,
    );
    return { cwd: basePath, isWorktree: false };
  }
  const shortId = externalRunId.slice(-10);
  const branchName = `tale/run-${shortId}`;
  const worktreeDir = path.join(basePath, '.tale-daemon', 'worktrees', shortId);
  mkdirSync(path.dirname(worktreeDir), { recursive: true });
  const added = await git(basePath, [
    'worktree',
    'add',
    '-b',
    branchName,
    worktreeDir,
  ]);
  if (!added.ok) {
    // Branch may exist from a retried attempt — reuse it detached-safe.
    const reattach = await git(basePath, [
      'worktree',
      'add',
      worktreeDir,
      branchName,
    ]);
    if (!reattach.ok) {
      console.warn(
        '[tale-daemon] worktree creation failed — running in place.',
      );
      return { cwd: basePath, isWorktree: false };
    }
  }
  return { cwd: worktreeDir, branchName, isWorktree: true };
}

/** Post-run report: committed + uncommitted change stat on the run branch. */
export async function collectDiffStat(
  workspace: RunWorkspace,
): Promise<string | undefined> {
  if (!workspace.isWorktree) return undefined;
  const parts: string[] = [];
  const dirty = await git(workspace.cwd, ['diff', '--stat', 'HEAD']);
  if (dirty.ok && dirty.stdout.trim()) parts.push(dirty.stdout.trim());
  const untracked = await git(workspace.cwd, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  if (untracked.ok && untracked.stdout.trim()) {
    parts.push(`new files:\n${untracked.stdout.trim()}`);
  }
  if (workspace.branchName) {
    parts.push(`branch: ${workspace.branchName}`);
  }
  return parts.length > 0 ? parts.join('\n').slice(0, 1_800) : undefined;
}
