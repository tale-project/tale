'use client';

import type { NodeProps } from '@xyflow/react';
import { RefreshCw, Repeat } from 'lucide-react';
import { memo } from 'react';

import { cn } from '../../../lib/cn';
import { ChangeKindBadge } from '../../data-display/change-list';
import { FLOW_EDGE_COLORS, FLOW_EDGE_DASH } from '../edge-palette';
import { roundedOrthogonalPath } from '../layout/geometry';
import { FLOW_MOTION_CLASS } from '../motion/flow-motion';
import type { FlowGroup, FlowRect } from '../types';
import { FLOW_DIFF_BADGE_MOTION } from './chrome';
import { useFlowRender, type FlowPhase } from './flow-render-context';

export interface FlowFrameData extends Record<string, unknown> {
  group: FlowGroup;
  /** The header's box, relative to the frame. */
  header: FlowRect;
  /** The members' boxes, relative to the frame (where a repeat's loop
   *  arc runs). */
  members: readonly FlowRect[];
  /** Joining (a new or resized frame fades in) or leaving with a live
   *  relayout. */
  phase?: FlowPhase;
}

/** How far a repeat's loop arc stands off its node's right side. */
const ARC_OFFSET = 20;

/**
 * The frame round a step that runs once per item (`each`) or repeats
 * (`repeat`): a dashed, lightly filled box behind its member with the
 * host's words in its header. Decoration only — every member's description
 * says the same — so it is hidden from assistive technology and never
 * takes a pointer. A repeat draws its loop as a dashed arc in its right
 * gutter, from the node's foot back to its head. In a run, a counter in
 * its top-right corner says how far it got ("12 of 50 items", "Pass 3 of
 * 5"); the member's strip says the same. Two versions compared draw a
 * frame only one of them has in its change's colour, its badge in the
 * counter's corner.
 */
export const FlowGroupFrameView = memo(function FlowGroupFrameView({
  data,
}: NodeProps & { data: FlowFrameData }) {
  const { group, header, members, phase } = data;
  const { frameCounters, frameDiffs } = useFlowRender();
  const counter = phase === 'exit' ? undefined : frameCounters.get(group.id);
  const changed = phase === 'exit' ? undefined : frameDiffs.get(group.id);
  const Icon = group.kind === 'repeat' ? RefreshCw : Repeat;
  const member = members[0];
  return (
    <div
      aria-hidden="true"
      data-flow-frame={phase === 'exit' ? undefined : group.id}
      data-flow-diff={changed}
      className={cn(
        'border-border bg-muted/30 pointer-events-none relative size-full rounded-xl border border-dashed',
        changed === 'added' && 'border-diff-added border-2',
        changed === 'removed' && 'border-diff-removed border-2',
        phase === 'enter' && FLOW_MOTION_CLASS.fadeIn,
        phase === 'exit' && FLOW_MOTION_CLASS.fadeOut,
      )}
    >
      {/* One row: the header's words in the box the layout kept for them,
          and in a run the counter at the frame's right edge. A long label
          ends in an ellipsis before the counter, never under it. */}
      <div
        className="absolute right-2 flex items-center gap-2"
        style={{ left: header.x, top: header.y, height: header.height }}
      >
        <div
          data-slot="flow-frame-header"
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 px-1 text-xs leading-4 font-medium"
          style={{ width: header.width }}
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{group.label}</span>
        </div>
        {changed !== undefined && (
          <ChangeKindBadge
            kind={changed}
            className={cn('bg-background ml-auto', FLOW_DIFF_BADGE_MOTION)}
          />
        )}
        {counter && (
          <span
            data-slot="flow-frame-counter"
            className="bg-background text-foreground border-border ml-auto inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap tabular-nums"
          >
            {counter}
          </span>
        )}
      </div>
      {group.kind === 'repeat' && member && (
        <svg className="absolute inset-0 size-full overflow-visible">
          <path
            d={roundedOrthogonalPath(
              [
                {
                  x: member.x + member.width,
                  y: member.y + member.height - 16,
                },
                {
                  x: member.x + member.width + ARC_OFFSET,
                  y: member.y + member.height - 16,
                },
                { x: member.x + member.width + ARC_OFFSET, y: member.y + 16 },
                { x: member.x + member.width + 8, y: member.y + 16 },
              ],
              8,
            )}
            fill="none"
            strokeWidth={2}
            strokeDasharray={FLOW_EDGE_DASH.order}
            style={{ stroke: FLOW_EDGE_COLORS.flow }}
          />
          <path
            d={`M${member.x + member.width + 8} ${member.y + 11} L${member.x + member.width} ${member.y + 16} L${member.x + member.width + 8} ${member.y + 21} Z`}
            style={{ fill: FLOW_EDGE_COLORS.flow }}
          />
        </svg>
      )}
    </div>
  );
});
