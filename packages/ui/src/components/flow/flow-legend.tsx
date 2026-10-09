'use client';

import { CircleHelp } from 'lucide-react';
import { useId } from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { Popover } from '../overlays/popover';
import { Button } from '../primitives/button';
import {
  FLOW_EDGE_COLORS,
  FLOW_EDGE_STROKE,
  flowEdgeDash,
  flowEdgeTone,
} from './edge-palette';
import { FLOW_NODE_DASHED, FLOW_TOUCH_TARGET } from './render/chrome';
import type { FlowEdgeKind } from './types';

/** One line of the legend: what a mark looks like and what it means. */
export interface FlowLegendEntry {
  id: string;
  /** A line of this edge kind, or one of the boxes. */
  swatch: { edge: FlowEdgeKind } | { node: 'dashed' | 'gate' | 'frame' };
  /** The meaning, in the host's words. */
  label: string;
}

/** A 32 × 12 picture of the mark, drawn with the canvas's own tokens. */
function Swatch({ swatch }: { swatch: FlowLegendEntry['swatch'] }) {
  if ('edge' in swatch) {
    const color = FLOW_EDGE_COLORS[flowEdgeTone(swatch.edge)];
    return (
      <svg
        aria-hidden="true"
        width={32}
        height={12}
        viewBox="0 0 32 12"
        className="shrink-0"
      >
        <path
          d="M1 6 H24"
          fill="none"
          strokeWidth={FLOW_EDGE_STROKE.base}
          strokeDasharray={flowEdgeDash(swatch.edge)}
          strokeLinecap={swatch.edge === 'completion' ? 'round' : 'butt'}
          style={{ stroke: color }}
        />
        <path d="M24 1 L31 6 L24 11 Z" style={{ fill: color }} />
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-card inline-block h-3 w-8 shrink-0 border',
        swatch.node === 'dashed' && cn('rounded-sm', FLOW_NODE_DASHED),
        swatch.node === 'gate' && 'border-muted-foreground rounded-full',
        swatch.node === 'frame' &&
          'border-muted-foreground bg-muted/30 rounded-sm border-dashed',
      )}
    />
  );
}

/**
 * How to read the chart: a button in the canvas's corner cluster that opens
 * a popover with one line per mark — each drawn with the real stroke or box
 * style beside the host's words for it. The host decides which marks its
 * charts use and what they mean.
 */
export function FlowLegend({
  entries,
  className,
}: {
  entries: readonly FlowLegendEntry[];
  className?: string;
}) {
  const { t } = useT('flow');
  const titleId = useId();
  if (entries.length === 0) return null;
  return (
    <Popover
      side="right"
      align="end"
      aria-labelledby={titleId}
      contentClassName="max-w-80"
      trigger={
        <Button
          size="icon"
          variant="secondary"
          title={t('controls.legend')}
          tooltipSide="right"
          className={cn(FLOW_TOUCH_TARGET, className)}
        >
          <CircleHelp className="size-4" />
        </Button>
      }
    >
      <h2 id={titleId} className="mb-2 text-sm font-medium">
        {t('legend.title')}
      </h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-start gap-3 text-xs leading-4"
          >
            <span className="flex h-4 items-center">
              <Swatch swatch={entry.swatch} />
            </span>
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
