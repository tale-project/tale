'use client';

import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  MinusCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type * as React from 'react';

import { useT } from '@/lib/i18n/client';

import type { NodeRunStatus, RunStatus } from '../lib/run-view';

type BadgeVariant = 'green' | 'destructive' | 'yellow' | 'blue' | 'slate';
type StatusIcon = React.ComponentType<React.ComponentProps<typeof Loader2>>;

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
 * What a run did to one node. `pending` means the run has not reached the node
 * yet; the engine's `not_run` means it finished without ever reaching it;
 * `stopped` means the run was stopped while on it; `waiting` means it waits
 * there for a person; `interrupted` means its server stopped while on it —
 * different facts, so they read differently, and only a node something is
 * working on spins.
 */
const NODE_STATUS_STYLE: Record<
  NodeRunStatus,
  { variant: BadgeVariant; icon: StatusIcon }
> = {
  ok: { variant: 'green', icon: CheckCircle2 },
  skipped: { variant: 'slate', icon: MinusCircle },
  error: { variant: 'destructive', icon: XCircle },
  not_run: { variant: 'slate', icon: CircleDashed },
  pending: { variant: 'blue', icon: Clock },
  running: { variant: 'blue', icon: RunningIcon },
  waiting: { variant: 'yellow', icon: Clock },
  interrupted: { variant: 'blue', icon: RefreshCw },
  stopped: { variant: 'slate', icon: Ban },
};

export function RunStatusBadge({ status }: { status: NodeRunStatus }) {
  const { t } = useT('automations');
  const { variant, icon } = NODE_STATUS_STYLE[status];
  return (
    <Badge variant={variant} icon={icon}>
      {t(`runs.nodeStatus.${status}`)}
    </Badge>
  );
}

/** The badge palette, as icon-only foreground colours — for surfaces too
 * dense for a badge per row. */
const NODE_STATUS_ICON_COLOR: Record<BadgeVariant, string> = {
  green: 'text-green-600',
  destructive: 'text-destructive',
  yellow: 'text-yellow-600',
  blue: 'text-blue-600',
  slate: 'text-slate-400',
};

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
  const { variant, icon: Icon } = NODE_STATUS_STYLE[status];
  return (
    <Icon
      role="img"
      aria-label={t(`runs.nodeStatus.${status}`)}
      className={cn(
        'size-4 shrink-0',
        NODE_STATUS_ICON_COLOR[variant],
        className,
      )}
    />
  );
}
