'use client';

import { Badge } from '@tale/ui/badge';
import { AlertTriangle, Box, Loader2, Moon, Pin } from 'lucide-react';
import type { ComponentType } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import {
  useChatAgents,
  useSessionProgress,
  useThreadSandboxState,
} from '../hooks/queries';

interface SandboxStateIndicatorProps {
  threadId: string | undefined;
  organizationId: string;
}

// Always-spinning loader so the Badge `icon` prop (which only passes a
// className) can still animate. The reduced-motion branch swaps in the plain
// Loader2 instead.
function SpinningLoader({ className }: { className?: string }) {
  return <Loader2 className={cn(className, 'animate-spin')} />;
}

type SandboxBadgeVariant = 'outline' | 'yellow' | 'orange' | 'green';

/**
 * Ambient composer pill that mirrors the thread's sandbox VM lifecycle, so the
 * user can see the agent runs in an isolated environment with a persistent
 * workspace — and understand why a sleeping sandbox takes a moment to wake (the
 * "idle = stop & preserve" behavior).
 *
 * Self-gating: renders only when the composer's active agent is an external
 * agent (Claude Code OR OpenCode — the sandbox fact is CLI-agnostic, unlike the
 * claude-code-only Plan/Act toggle) AND the thread has a live session or a
 * running turn. The live op (`running`) outranks the lifecycle status, so a
 * turn started on a sleeping sandbox transitions Sleeping → Working directly,
 * never flashing "Starting".
 */
export function SandboxStateIndicator({
  threadId,
  organizationId,
}: SandboxStateIndicatorProps) {
  const { t } = useT('chat');
  const prefersReducedMotion = usePrefersReducedMotion();
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);

  const active = selectedAgent
    ? agents?.find((a) => a.name === selectedAgent.name)
    : undefined;
  const isExternal = active?.primaryBehavior === 'external-agent';

  // Only subscribe on external-agent threads — a normal chat thread passes
  // `undefined` (→ 'skip'), so it costs no live subscription / indexed read.
  const gatedThreadId = isExternal ? threadId : undefined;
  const state = useThreadSandboxState(gatedThreadId);
  const progress = useSessionProgress(gatedThreadId);

  if (!isExternal) return null;
  const running = progress?.status === 'running';

  const Spinner = prefersReducedMotion ? Loader2 : SpinningLoader;

  let variant: SandboxBadgeVariant;
  let icon: ComponentType<{ className?: string }>;
  let label: string;
  let tooltip: string;

  if (running) {
    variant = 'green';
    icon = Spinner;
    label = t('sandbox.working');
    tooltip = t('sandbox.workingTooltip');
  } else if (state?.status === 'stopped') {
    variant = 'yellow';
    icon = Moon;
    label = t('sandbox.sleeping');
    tooltip = t('sandbox.sleepingTooltip');
  } else if (state?.status === 'creating') {
    variant = 'outline';
    icon = Spinner;
    label = t('sandbox.starting');
    tooltip = t('sandbox.startingTooltip');
  } else if (state?.status === 'degraded') {
    variant = 'orange';
    icon = AlertTriangle;
    label = t('sandbox.recovering');
    tooltip = t('sandbox.recoveringTooltip');
  } else if (state?.status === 'active') {
    // Warm container, idle — the next message starts instantly.
    variant = 'outline';
    icon = Box;
    label = t('sandbox.ready');
    tooltip = t('sandbox.readyTooltip');
  } else {
    // No live session yet (the agent is selected but hasn't run in this
    // thread): show the resting identity so the user perceives the sandbox VM
    // before the first turn provisions it.
    variant = 'outline';
    icon = Box;
    label = t('sandbox.label');
    tooltip = t('sandbox.tooltip');
  }

  return (
    <div
      className="flex items-center gap-1"
      aria-label={t('sandbox.ariaLabel')}
    >
      <Tooltip content={tooltip} side="top" contentClassName="max-w-xs">
        <span className="inline-flex cursor-help">
          <Badge variant={variant} icon={icon} className="h-8 rounded-full">
            {label}
          </Badge>
        </span>
      </Tooltip>
      {state?.pinned && (
        <Tooltip content={t('sandbox.pinnedTooltip')} side="top">
          <span className="inline-flex cursor-help">
            <Badge variant="blue" icon={Pin} className="h-8 rounded-full">
              {t('sandbox.pinned')}
            </Badge>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
