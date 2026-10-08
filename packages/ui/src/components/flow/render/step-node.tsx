'use client';

import type { NodeProps } from '@xyflow/react';
import { Box, CornerDownRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { ISSUE_SEVERITY_CHIP_CLASS } from '../../feedback/issue-severity';
import { SKELETON_PULSE } from '../../feedback/skeleton';
import { FlowNodeIssueMarker } from '../node-issue-marker';
import { FlowNodeStatusIcon } from '../node-status';
import type { FlowChip, FlowIcon, FlowStepNode } from '../types';
import {
  FlowNodeButton,
  FlowNodeStrip,
  useFlowRender,
  type FlowPhase,
} from './flow-render-context';

/** The data React Flow carries for a box. */
export interface FlowNodeData<T> extends Record<string, unknown> {
  node: T;
  /** Joining or leaving with a live relayout. */
  phase?: FlowPhase;
}

const CHIP_TONE: Record<NonNullable<FlowChip['tone']>, string> = {
  neutral: 'border-border text-foreground border',
  info: 'border border-current/30 text-[hsl(var(--info-foreground))]',
  warning: ISSUE_SEVERITY_CHIP_CLASS.warning,
  error: ISSUE_SEVERITY_CHIP_CLASS.error,
};

/** A short word on a box's face: 20 px, never wrapping. */
function FlowChipPill({ chip }: { chip: FlowChip }) {
  const Icon = chip.icon;
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-[11rem] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap',
        CHIP_TONE[chip.tone ?? 'neutral'],
      )}
    >
      {Icon && <Icon className="size-3 shrink-0" />}
      <span className="truncate">{chip.label}</span>
    </span>
  );
}

/** The title row every box shares: icon tile, title, glyphs, problems and,
 *  in a run, the state's glyph. */
export function FlowNodeTitleRow({
  id,
  icon: Icon,
  title,
  trailing,
}: {
  id: string;
  icon: FlowIcon;
  title: string;
  trailing?: ReactNode;
}) {
  const { issues, looks } = useFlowRender();
  const counts = issues.get(id);
  const state = looks.get(id)?.state ?? 'idle';
  return (
    <span className="flex h-5 items-center gap-2">
      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium">
        {title}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {trailing}
        {counts && (
          <FlowNodeIssueMarker
            errors={counts.errors}
            warnings={counts.warnings}
          />
        )}
        <FlowNodeStatusIcon state={state} className="size-3.5" />
      </span>
    </span>
  );
}

/**
 * A step: icon, title, what kind of step it is, what it returns, up to two
 * chips, and a strip saying what it reads. 288 px wide; 88 to 136 px high
 * by the rows its data has (`flowNodeSize`). A step that may be skipped, or
 * never runs, has a dashed border — never faded text.
 */
export const FlowStepNodeView = memo(function FlowStepNodeView({
  data,
}: NodeProps & { data: FlowNodeData<FlowStepNode> }) {
  const { t } = useT('flow');
  const { node, phase } = data;
  const chips = node.chips ?? [];
  const shown = chips.slice(0, 2);
  const hidden = chips.length - shown.length;
  const hasChips = chips.length > 0 || node.unreachable === true;
  return (
    <FlowNodeButton
      id={node.id}
      phase={phase}
      dashed={node.conditional === true || node.unreachable === true}
      className="bg-card text-card-foreground border-border flex flex-col rounded-lg border shadow-sm"
    >
      <span className="flex min-h-0 flex-1 flex-col px-3 pt-3">
        <FlowNodeTitleRow
          id={node.id}
          icon={node.icon ?? Box}
          title={node.label}
          trailing={(node.markers ?? []).map((marker) => (
            <span
              key={marker.id}
              title={marker.label}
              className={cn(
                'inline-flex',
                marker.tone === 'warning'
                  ? 'text-amber-700 dark:text-amber-500'
                  : 'text-muted-foreground',
              )}
            >
              <marker.icon className="size-3.5" />
            </span>
          ))}
        />
        <span className="text-muted-foreground h-4 truncate text-xs leading-4">
          {node.typeLabel}
        </span>
        {node.returns !== undefined && (
          <span className="text-muted-foreground mt-1 flex h-4 items-center gap-1 text-xs leading-4">
            <CornerDownRight className="size-3 shrink-0" aria-hidden="true" />
            {node.returns === null ? (
              <span
                aria-hidden="true"
                className={cn(SKELETON_PULSE, 'h-2.5 w-3/5 rounded')}
              />
            ) : (
              <span
                className={cn('truncate', node.returns.code && 'font-mono')}
              >
                {node.returns.text}
              </span>
            )}
          </span>
        )}
        {hasChips && (
          <span className="mt-2 flex h-5 items-center gap-1 overflow-hidden">
            {node.unreachable && (
              <FlowChipPill
                chip={{ id: 'unreachable', label: t('node.unreachable') }}
              />
            )}
            {shown.map((chip) => (
              <FlowChipPill key={chip.id} chip={chip} />
            ))}
            {hidden > 0 && (
              <span className="text-muted-foreground shrink-0 text-xs">
                {t('node.more', { count: hidden })}
              </span>
            )}
          </span>
        )}
      </span>
      <FlowNodeStrip id={node.id} />
    </FlowNodeButton>
  );
});
