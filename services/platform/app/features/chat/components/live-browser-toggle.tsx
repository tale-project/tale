'use client';

import { Button } from '@tale/ui/button';
import { MonitorPlay } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useLiveBrowserOptional } from '@/app/features/workspace/components/live-browser-context';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents, useThreadSandboxState } from '../hooks/queries';

interface LiveBrowserToggleProps {
  threadId: string | undefined;
  organizationId: string;
  disabled?: boolean;
}

/**
 * Composer pill that opens/closes the read-only "Live browser" pane — a
 * near-video VNC stream of the external-agent's headed Chromium.
 *
 * Self-gating: renders only when the composer's active agent is an external
 * agent (Claude Code OR OpenCode — browser use is CLI-agnostic, like the
 * Sandbox / Workspace-files pills) AND the thread has a live session that
 * exists (any lifecycle status). A normal chat thread, or an external-agent
 * thread that has never run, renders nothing. The pane itself shows a gated
 * empty state when the session isn't actively running, so opening the pill
 * before a turn starts is harmless.
 */
export function LiveBrowserToggle({
  threadId,
  organizationId,
  disabled,
}: LiveBrowserToggleProps) {
  const { t } = useT('chat');
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);
  const live = useLiveBrowserOptional();

  const active = selectedAgent
    ? agents?.find((a) => a.name === selectedAgent.name)
    : undefined;
  const isExternal = active?.primaryBehavior === 'external-agent';

  // Only subscribe on external-agent threads — a normal chat thread passes
  // undefined (→ 'skip'), so it costs no live subscription.
  const gatedThreadId = isExternal ? threadId : undefined;
  const state = useThreadSandboxState(gatedThreadId);

  if (!isExternal || !live) return null;
  // A session must exist (any lifecycle state) for there to be anything to
  // stream. `state` is null on a thread whose agent has never provisioned one.
  if (!state) return null;

  const isOpen = live.isOpen;

  return (
    <Tooltip
      content={t('liveBrowser.toggleTooltip', {
        defaultValue: 'Watch the agent’s browser live (view only)',
      })}
      side="top"
      contentClassName="max-w-xs"
    >
      <Button
        variant="ghost"
        size="sm"
        icon={MonitorPlay}
        disabled={disabled}
        aria-pressed={isOpen}
        aria-label={t('liveBrowser.toggleLabel', {
          defaultValue: 'Live browser',
        })}
        onClick={() => live.toggle()}
        className={cn(
          'h-8 shrink-0 rounded-full',
          isOpen && 'bg-primary/10 text-primary',
        )}
      >
        {t('liveBrowser.toggleLabel', { defaultValue: 'Live browser' })}
      </Button>
    </Tooltip>
  );
}
