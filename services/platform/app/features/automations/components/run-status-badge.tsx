'use client';

import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import { FLOW_NODE_STATE } from '@tale/ui/flow/node-status';
import {
  Ban,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type * as React from 'react';

import { useT } from '@/lib/i18n/client';

import {
  flowNodeState,
  type NodeRunStatus,
  type RunStatus,
} from '../lib/run-view';

type BadgeVariant = 'green' | 'destructive' | 'yellow' | 'blue' | 'slate';
type StatusIcon = React.ComponentType<{ className?: string }>;

/** `Badge` hardcodes the icon className, so spinning must live on the icon. */
function RunningIcon({
  className,
  ...props
}: React.ComponentProps<typeof Loader2>) {
  return (
    <Loader2
      {...props}
      className={cn(className, 'animate-spin motion-reduce:animate-none')}
    />
  );
}

/**
 * How a run reads at a glance. Colour is never the only signal: each state
 * carries its own icon and its own word, so the badge survives a colour-blind
 * reader, a greyscale print, and a screen reader alike.
 */
const RUN_STATUS_STYLE: Record<
  RunStatus,
  { variant: BadgeVariant; icon: StatusIcon }
> = {
  queued: { variant: 'slate', icon: Clock },
  running: { variant: 'blue', icon: RunningIcon },
  waiting: { variant: 'yellow', icon: Clock },
  quarantined: { variant: 'yellow', icon: Clock },
  success: { variant: 'green', icon: CheckCircle2 },
  failed: { variant: 'destructive', icon: XCircle },
  cancelled: { variant: 'slate', icon: Ban },
};

/**
 * The state of one run. A running run whose server stopped reads
 * "Interrupted — resuming" until another server takes it over: its own word
 * and a still icon (nothing is working on it yet, so nothing spins), in the
 * running family's blue — it needs nobody, so it does not outshout a run
 * that waits for a person, nor match the orange Live badge beside it.
 */
export function RunBadge({
  status,
  stalled = false,
}: {
  status: RunStatus;
  /** A running run nobody is stepping right now (`Run.stalled`). */
  stalled?: boolean;
}) {
  const { t } = useT('automations');
  if (status === 'running' && stalled) {
    return (
      <Badge variant="blue" icon={RefreshCw}>
        {t('runs.status.stalled')}
      </Badge>
    );
  }
  const { variant, icon } = RUN_STATUS_STYLE[status];
  return (
    <Badge variant={variant} icon={icon}>
      {t(`runs.status.${status}`)}
    </Badge>
  );
}

/**
 * What a run did to one node, in the canvas's own vocabulary
 * (`@tale/ui/flow/node-status`): the same glyph and colour as the node's box
 * and its row in the List view, every glyph colour at 3:1 or better. The
 * words stay this page's own — "Ran", "Never reached", "Not reached yet" —
 * because they tell apart facts the canvas's shorter words merge. A node
 * whose server stopped keeps a still glyph of its own: nothing works on it
 * until another server takes it over, so nothing spins.
 */
function nodeStatusLook(status: NodeRunStatus): {
  variant: BadgeVariant;
  icon: StatusIcon;
  iconClass: string;
} {
  if (status === 'interrupted') {
    return {
      variant: 'blue',
      icon: RefreshCw,
      iconClass: 'text-[hsl(var(--info-foreground))]',
    };
  }
  const { badge, icon, iconClass } = FLOW_NODE_STATE[flowNodeState(status)];
  return { variant: badge, icon, iconClass };
}

export function RunStatusBadge({ status }: { status: NodeRunStatus }) {
  const { t } = useT('automations');
  const { variant, icon } = nodeStatusLook(status);
  return (
    <Badge variant={variant} icon={icon}>
      {t(`runs.nodeStatus.${status}`)}
    </Badge>
  );
}

/**
 * The same node-status vocabulary as {@link RunStatusBadge}, compressed to its
 * icon — the step timeline shows one per row, where a full badge would drown
 * the step names. The status word stays for a screen reader.
 */
export function NodeStatusIcon({
  status,
  className,
}: {
  status: NodeRunStatus;
  className?: string;
}) {
  const { t } = useT('automations');
  const { icon: Icon, iconClass } = nodeStatusLook(status);
  return (
    <span
      role="img"
      aria-label={t(`runs.nodeStatus.${status}`)}
      className="inline-flex"
    >
      <Icon
        aria-hidden="true"
        className={cn('size-4 shrink-0', iconClass, className)}
      />
    </span>
  );
}
