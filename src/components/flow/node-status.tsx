'use client';

import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Clock,
  History,
  Hourglass,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { Badge } from '../feedback/badge';
import type { FlowIcon } from './types';

/**
 * The one vocabulary for where a node stands in a run — the canvas, the List
 * view, a run's step list and a badge all say it the same way. Every state
 * has its own glyph and its own word, so none is told by colour alone.
 */
export type FlowNodeState =
  /** No run is shown. */
  | 'idle'
  | 'pending'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'stopped'
  | 'not-run'
  /** Not run in this run: its result was taken from an earlier one (a run
   *  retried from a later step). */
  | 'reused';

export type FlowShownState = Exclude<FlowNodeState, 'idle'>;

/** Spins unless the reader asked for less motion. */
function SpinningLoader({ className, ...props }: ComponentProps<LucideIcon>) {
  return (
    <LoaderCircle
      {...props}
      className={cn(className, 'motion-safe:animate-spin')}
    />
  );
}

/**
 * Glyph, badge tint, glyph colour and the key of the state's word (in the
 * `flow` namespace). Every glyph colour keeps 3:1 on the page, a card and
 * a muted fill in both themes (none is `slate-400`, which read 2.6:1).
 */
export const FLOW_NODE_STATE: Readonly<
  Record<
    FlowShownState,
    {
      icon: FlowIcon;
      badge: 'blue' | 'yellow' | 'green' | 'destructive' | 'slate';
      iconClass: string;
      labelKey: string;
    }
  >
> = {
  pending: {
    icon: Clock,
    badge: 'slate',
    iconClass: 'text-muted-foreground',
    labelKey: 'state.pending',
  },
  running: {
    icon: SpinningLoader,
    badge: 'blue',
    iconClass: 'text-[hsl(var(--info-foreground))]',
    labelKey: 'state.running',
  },
  waiting: {
    icon: Hourglass,
    badge: 'yellow',
    iconClass: 'text-amber-700 dark:text-amber-500',
    labelKey: 'state.waiting',
  },
  succeeded: {
    icon: CircleCheck,
    badge: 'green',
    iconClass: 'text-[hsl(var(--success))]',
    labelKey: 'state.succeeded',
  },
  failed: {
    icon: CircleX,
    badge: 'destructive',
    iconClass: 'text-destructive',
    labelKey: 'state.failed',
  },
  skipped: {
    icon: CircleMinus,
    badge: 'slate',
    iconClass: 'text-muted-foreground',
    labelKey: 'state.skipped',
  },
  stopped: {
    icon: Ban,
    badge: 'slate',
    iconClass: 'text-muted-foreground',
    labelKey: 'state.stopped',
  },
  'not-run': {
    icon: CircleDashed,
    badge: 'slate',
    iconClass: 'text-muted-foreground',
    labelKey: 'state.notRun',
  },
  reused: {
    icon: History,
    badge: 'slate',
    iconClass: 'text-muted-foreground',
    labelKey: 'state.reused',
  },
};

/** The state's word in the session's language ("Skipped"). */
export function useFlowNodeStateLabel(): (state: FlowShownState) => string {
  const { t } = useT('flow');
  return (state) => t(FLOW_NODE_STATE[state].labelKey);
}

/** The state's glyph, named for a screen reader; nothing while idle. */
export function FlowNodeStatusIcon({
  state,
  className,
}: {
  state: FlowNodeState;
  className?: string;
}) {
  const label = useFlowNodeStateLabel();
  if (state === 'idle') return null;
  const { icon: Icon, iconClass } = FLOW_NODE_STATE[state];
  return (
    <span role="img" aria-label={label(state)} className="inline-flex">
      <Icon
        aria-hidden="true"
        className={cn('size-4 shrink-0', iconClass, className)}
      />
    </span>
  );
}

/** The state as a badge — glyph and word; nothing while idle. */
export function FlowNodeStatusBadge({ state }: { state: FlowNodeState }) {
  const label = useFlowNodeStateLabel();
  if (state === 'idle') return null;
  const { icon, badge } = FLOW_NODE_STATE[state];
  return (
    <Badge variant={badge} icon={icon}>
      {label(state)}
    </Badge>
  );
}
