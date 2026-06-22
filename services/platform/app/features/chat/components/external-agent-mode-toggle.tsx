'use client';

import { Row } from '@tale/ui/layout';
import { useMutation } from 'convex/react';
import { ClipboardList, Zap } from 'lucide-react';
import { useCallback } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';

interface ExternalAgentModeToggleProps {
  threadId: string | undefined;
  organizationId: string;
  disabled?: boolean;
}

/**
 * Composer Plan | Act toggle for Claude Code external-agent threads — the
 * chat analogue of the CLI's Shift+Tab plan mode. Sticky per thread
 * (`threadMetadata.externalAgentMode`); Plan turns run read-only and end in a
 * plan-approval card, approval flips the thread to Act and executes.
 *
 * Self-gating: renders only when the composer's active agent is a claude-code
 * external agent AND a thread exists (a new chat starts in the default Act —
 * the toggle appears once the first message creates the thread). The mode is
 * also flipped by the backend (plan detection → plan, approval → act), so
 * this control doubles as an ambient indicator of the agent's actual state.
 */
export function ExternalAgentModeToggle({
  threadId,
  organizationId,
  disabled,
}: ExternalAgentModeToggleProps) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);
  const { data: meta } = useConvexQuery(
    api.threads.queries.getThreadMeta,
    threadId ? { threadId } : 'skip',
  );
  const setMode = useMutation(api.threads.mutations.setExternalAgentMode);

  const mode: 'plan' | 'act' = meta?.externalAgentMode ?? 'act';

  const handleSelect = useCallback(
    (next: 'plan' | 'act') => {
      if (!threadId || next === mode) return;
      void setMode({ threadId, mode: next }).catch((err: unknown) => {
        console.error('[plan-mode] toggle failed', err);
        toast({
          title: t('planMode.toggleFailed'),
          variant: 'destructive',
        });
      });
    },
    [threadId, mode, setMode, toast, t],
  );

  if (!threadId) return null;
  const active = selectedAgent
    ? agents?.find((a) => a.name === selectedAgent.name)
    : undefined;
  if (
    active?.primaryBehavior !== 'external-agent' ||
    active.agentKind !== 'claude-code'
  ) {
    return null;
  }

  return (
    <Row
      role="radiogroup"
      aria-label={t('planMode.label')}
      gap={0}
      className="border-border bg-muted/40 h-8 rounded-full border p-0.5"
    >
      <Tooltip content={t('planMode.planTooltip')} side="top">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'plan'}
          disabled={disabled}
          onClick={() => handleSelect('plan')}
          className={cn(
            'flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors',
            mode === 'plan'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ClipboardList className="size-3.5" />
          {t('planMode.plan')}
        </button>
      </Tooltip>
      <Tooltip content={t('planMode.actTooltip')} side="top">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'act'}
          disabled={disabled}
          onClick={() => handleSelect('act')}
          className={cn(
            'flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors',
            mode === 'act'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Zap className="size-3.5" />
          {t('planMode.act')}
        </button>
      </Tooltip>
    </Row>
  );
}
