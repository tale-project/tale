'use client';

import {
  Loader2,
  TriangleAlert,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { formatToolDetail } from '../../utils/format-tool-detail';
import { routeReasonLabel, type RouteReason } from '../../utils/route-reason';
import type { ThoughtStep } from '../../utils/thought-step-types';
import { TypewriterText } from '../typewriter-text';
import { REASONING_MARKDOWN_COMPONENTS } from './reasoning-markdown';
import { toolIcon } from './tool-icon';

/**
 * The single subordination indent, shared by the inline reasoning body AND the
 * nested delegation timeline so they read as the SAME peer construct — one
 * `border-l` level, never a stack of them. (Previously these diverged:
 * `ml-1.5 border-l pl-3` for reasoning vs `ml-5 border-l pl-3` for delegation.)
 */
export const STEP_INDENT = 'border-border/60 ml-2 border-l pl-3';

type StepStatus = 'active' | 'error' | 'done';

/**
 * The one row primitive every icon+title step renders through (tools, routing,
 * delegation), so they all share the exact same left edge, leading-icon column,
 * and spacing. A SINGLE leading glyph conveys state — a spinner while live, a
 * warning on error, otherwise the family icon — instead of the old two-glyph
 * (status dot + family icon) layout. The title text already names the work, so
 * one glyph is enough and the rows stay flat.
 */
function StepRow({
  icon: Icon,
  status,
  title,
  detail,
}: {
  icon: LucideIcon;
  status: StepStatus;
  title: ReactNode;
  /** Optional second line (an error message, or a routing reason). */
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {status === 'active' ? (
          <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
        ) : status === 'error' ? (
          <TriangleAlert className="text-destructive size-3.5" />
        ) : (
          <Icon className="text-muted-foreground size-3.5" />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-foreground truncate">{title}</span>
        {detail != null && (
          <span
            className={cn(
              'text-xs break-words',
              status === 'error'
                ? 'text-destructive/80'
                : 'text-muted-foreground',
            )}
          >
            {detail}
          </span>
        )}
      </span>
    </div>
  );
}

export function ToolStepRow({
  step,
  active,
}: {
  step: Extract<ThoughtStep, { kind: 'tool' }>;
  /** Whether the OWNING message is still streaming. A tool stuck at
   *  input-available on a finished/aborted turn must NOT show a live spinner. */
  active: boolean;
}) {
  const { t } = useT('chat');
  const { displayText } = formatToolDetail(t, step.toolName, step.input);
  const isActive =
    active &&
    (step.state === 'input-streaming' || step.state === 'input-available');
  const isError = step.state === 'output-error';
  return (
    <StepRow
      icon={toolIcon(step.toolName)}
      // Non-active and never reached a terminal state (e.g. aborted mid-call,
      // left at input-available) resolves to 'done' → it shows the family icon,
      // NOT a spinner or a misleading success mark.
      status={isActive ? 'active' : isError ? 'error' : 'done'}
      title={displayText}
      detail={isError && step.errorText ? step.errorText : undefined}
    />
  );
}

export function RoutingStepRow({
  agentName,
  reason,
}: {
  agentName: string;
  reason: RouteReason;
}) {
  const { t } = useT('chat');
  return (
    <StepRow
      icon={Waypoints}
      status="done"
      title={t('routing.routedTo', { agent: agentName })}
      detail={routeReasonLabel(t, reason)}
    />
  );
}

/**
 * Reasoning prose — rendered inside the collapsible `InlineReasoning` body, not
 * through `StepRow` (it's a paragraph, not an icon+title row). Reveals with the
 * SAME smooth typewriter the answer uses while the block is live; a finished or
 * aborted block renders in full immediately. Redacted blocks show a neutral note.
 */
export function ReasoningStepRow({
  step,
  active,
}: {
  step: Extract<ThoughtStep, { kind: 'reasoning' }>;
  /** Whether the OWNING message is still streaming — a reasoning block left
   *  stuck at `streaming` on an aborted turn must NOT keep animating. */
  active: boolean;
}) {
  const { t } = useT('chat');
  if (step.redacted) {
    return (
      <p className="text-muted-foreground text-sm italic">
        {t('thinking.redacted')}
      </p>
    );
  }
  return (
    <TypewriterText
      text={step.text}
      isStreaming={active && step.state === 'streaming'}
      components={REASONING_MARKDOWN_COMPONENTS}
      className="text-muted-foreground text-sm"
    />
  );
}
