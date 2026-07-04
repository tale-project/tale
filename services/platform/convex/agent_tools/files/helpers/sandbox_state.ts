/**
 * Sandbox-state manifest — the workspace ground truth attached to tool
 * results.
 *
 * Every tool that touches the thread workspace (file_write / file_edit /
 * file_delete / file_read / run_code, and spawn_agent when the worker was
 * granted workspace tools) reports the CURRENT workspace manifest on its
 * result, success or failure. The model always sees what actually exists —
 * what it (or a worker) already produced, what the user uploaded — so it
 * never recreates a file that is already there and never acts on a stale
 * mental model after a failed call.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';

export interface SandboxStateEntry {
  path: string;
  /** Storage id handoff token for the image / document_write tools. */
  fileId: string;
  size: number;
  contentType: string;
}

export interface SandboxState {
  uploads: SandboxStateEntry[];
  code: SandboxStateEntry[];
  outputs: SandboxStateEntry[];
}

/**
 * Build the manifest of the workspace-owning thread's files, grouped by
 * sandbox area. `workspaceThreadId` is the resolved owner (the parent chat
 * thread for sub-thread runs — see `getWorkspaceThreadId`).
 */
export async function buildSandboxState(
  ctx: ToolCtx,
  scope: { organizationId: string; workspaceThreadId: string },
): Promise<SandboxState> {
  const state: SandboxState = { uploads: [], code: [], outputs: [] };
  const rows = await ctx.runQuery(
    internal.thread_files.internal_queries.listThreadFiles,
    { threadId: scope.workspaceThreadId },
  );
  for (const e of rows
    .filter(
      (r: { organizationId: string }) =>
        r.organizationId === scope.organizationId,
    )
    .map(
      (r: {
        path: string;
        storageId: string;
        size: number;
        contentType: string;
        source: 'user_upload' | 'agent_write' | 'run_output';
      }) => ({
        entry: {
          path: r.path,
          fileId: r.storageId,
          size: r.size,
          contentType: r.contentType,
        },
        source: r.source,
      }),
    )) {
    if (e.source === 'user_upload') state.uploads.push(e.entry);
    else if (e.source === 'run_output') state.outputs.push(e.entry);
    else state.code.push(e.entry);
  }
  return state;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compact human-readable rendering of the sandbox-state manifest, appended to
 * a tool-result message. The structured `sandboxState` field carries the full
 * data (incl. every `fileId`); this is the at-a-glance summary.
 */
export function formatSandboxState(area: SandboxState): string {
  const lines: string[] = [];
  const render = (root: string, entries: SandboxStateEntry[]) => {
    if (entries.length === 0) return;
    const shown = entries.slice(0, 12);
    const names = shown
      .map((e) => `${e.path.slice(root.length + 1)} (${formatBytes(e.size)})`)
      .join(', ');
    const more =
      entries.length > shown.length
        ? ` … +${entries.length - shown.length} more`
        : '';
    lines.push(`  ${root}: ${names}${more}`);
  };
  render('/user/uploads', area.uploads);
  render('/user/code', area.code);
  render('/user/output', area.outputs);
  if (lines.length === 0) return '';
  return `Sandbox state (reference files by path; pass a file's fileId to the image / document_write tools):\n${lines.join('\n')}`;
}
