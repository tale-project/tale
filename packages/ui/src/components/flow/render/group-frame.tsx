'use client';

import type { NodeProps } from '@xyflow/react';
import { RefreshCw, Repeat } from 'lucide-react';
import { memo } from 'react';

import { FLOW_EDGE_COLORS, FLOW_EDGE_DASH } from '../edge-palette';
import { roundedOrthogonalPath } from '../layout/geometry';
import type { FlowGroup, FlowRect } from '../types';

export interface FlowFrameData extends Record<string, unknown> {
  group: FlowGroup;
  /** The header's box, relative to the frame. */
  header: FlowRect;
  /** The members' boxes, relative to the frame (where a repeat's loop
   *  arc runs). */
  members: readonly FlowRect[];
}

/** How far a repeat's loop arc stands off its node's right side. */
const ARC_OFFSET = 20;

/**
 * The frame round a step that runs once per item (`each`) or repeats
 * (`repeat`): a dashed, lightly filled box behind its member with the
 * host's words in its header. Decoration only — every member's description
 * says the same — so it is hidden from assistive technology and never
 * takes a pointer. A repeat draws its loop as a dashed arc in its right
 * gutter, from the node's foot back to its head.
 */
export const FlowGroupFrameView = memo(function FlowGroupFrameView({
  data,
}: NodeProps & { data: FlowFrameData }) {
  const { group, header, members } = data;
  const Icon = group.kind === 'repeat' ? RefreshCw : Repeat;
  const member = members[0];
  return (
    <div
      aria-hidden="true"
      data-flow-frame={group.id}
      className="border-border bg-muted/30 pointer-events-none relative size-full rounded-xl border border-dashed"
    >
      <div
        data-slot="flow-frame-header"
        className="text-muted-foreground absolute flex items-center gap-1.5 px-1 text-xs leading-4 font-medium"
        style={{
          left: header.x,
          top: header.y,
          width: header.width,
          height: header.height,
        }}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{group.label}</span>
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
