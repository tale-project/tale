'use client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents, useThreadSandboxState } from './queries';
import { useThreadAgentLock } from './use-thread-agent-lock';

/**
 * Whether the read-only sandbox observability panes (Workspace files + Live
 * browser) apply to the current thread.
 *
 * True when the composer's active agent is an external agent (Claude Code OR
 * OpenCode — the workspace/browser facts are CLI-agnostic, like the Sandbox
 * pill) AND the thread has a sandbox session that exists (any lifecycle status —
 * active/creating/degraded/stopped — means there's a workspace/browser to
 * observe; a `stopped` session keeps its preserved `/user`, and the panes show
 * a "resume to browse" empty state). A normal chat thread, or an external-agent
 * thread that has never run, returns false.
 *
 * Single source of truth so the desktop pane mounts (the collapsed strips ARE
 * the open affordance) and the mobile `+`-menu entries gate identically — there
 * is no longer a separate composer toggle pill (the strips/menu replace it).
 */
export function useSandboxPanesAvailable(
  organizationId: string,
  threadId: string | undefined,
): boolean {
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);
  // The thread's bound agent wins over the global per-user selection — a
  // switch made in ANOTHER thread must not hide this thread's sandbox panes.
  const { lockedAgent } = useThreadAgentLock(organizationId, threadId);
  const active =
    lockedAgent ??
    (selectedAgent
      ? agents?.find((a) => a.name === selectedAgent.name)
      : undefined);
  const isExternal = active?.primaryBehavior === 'external-agent';
  // Only subscribe on external-agent threads — a normal chat thread passes
  // undefined (→ 'skip'), so it costs no live subscription.
  const { state } = useThreadSandboxState(isExternal ? threadId : undefined);
  return isExternal && !!state;
}
