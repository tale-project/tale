'use client';

import { Button } from '@tale/ui/button';
import { FolderOpen } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useWorkspaceFilesOptional } from '@/app/features/workspace/components/workspace-files-context';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents, useThreadSandboxState } from '../hooks/queries';

interface WorkspaceFilesToggleProps {
  threadId: string | undefined;
  organizationId: string;
  disabled?: boolean;
}

/**
 * Composer pill that opens/closes the read-only "Workspace files" explorer for
 * external-agent sandbox threads.
 *
 * Self-gating: renders only when the composer's active agent is an external
 * agent (Claude Code OR OpenCode — the workspace fact is CLI-agnostic, like the
 * Sandbox pill) AND the thread has a live session that exists (any lifecycle
 * status — active/creating/degraded/stopped — means there's a workspace to
 * browse; a `stopped` session still has its preserved `/workspace`, and the
 * pane shows a "resume to browse" empty state). A normal chat thread, or an
 * external-agent thread that has never run, renders nothing.
 */
export function WorkspaceFilesToggle({
  threadId,
  organizationId,
  disabled,
}: WorkspaceFilesToggleProps) {
  const { t } = useT('chat');
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);
  const files = useWorkspaceFilesOptional();

  const active = selectedAgent
    ? agents?.find((a) => a.name === selectedAgent.name)
    : undefined;
  const isExternal = active?.primaryBehavior === 'external-agent';

  // Only subscribe on external-agent threads — a normal chat thread passes
  // undefined (→ 'skip'), so it costs no live subscription.
  const gatedThreadId = isExternal ? threadId : undefined;
  const state = useThreadSandboxState(gatedThreadId);

  if (!isExternal || !files) return null;
  // A session must exist (any lifecycle state) for there to be a workspace to
  // browse. `state` is null on a thread whose agent has never provisioned one.
  if (!state) return null;

  const isOpen = files.isOpen;

  return (
    <Tooltip
      content={t('workspaceFiles.toggleTooltip', {
        defaultValue: 'Browse the agent’s workspace files (read-only)',
      })}
      side="top"
      contentClassName="max-w-xs"
    >
      <Button
        variant="ghost"
        size="sm"
        icon={FolderOpen}
        disabled={disabled}
        aria-pressed={isOpen}
        aria-label={t('workspaceFiles.toggleLabel', {
          defaultValue: 'Workspace files',
        })}
        onClick={() => files.toggle()}
        className={cn(
          'h-8 shrink-0 rounded-full',
          isOpen && 'bg-primary/10 text-primary',
        )}
      >
        {t('workspaceFiles.toggleLabel', { defaultValue: 'Workspace files' })}
      </Button>
    </Tooltip>
  );
}
