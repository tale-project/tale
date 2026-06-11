import {
  AlertCircle,
  Bug,
  CheckCircle2,
  CirclePause,
  Loader2,
  XCircle,
} from 'lucide-react';

import type { ExecutionNodeStatus } from '@/convex/workflows/executions/get_execution_step_statuses';

/**
 * Status → icon/color conventions for per-step execution feedback, shared by
 * the canvas node badges (#1487) and the test panel's step list (#1484) so a
 * step always looks the same in both surfaces.
 */
export const EXECUTION_STATUS_ICONS: Record<
  ExecutionNodeStatus,
  { Icon: typeof Loader2; className: string }
> = {
  running: {
    Icon: Loader2,
    className:
      'animate-spin motion-reduce:animate-none text-blue-600 dark:text-blue-400',
  },
  success: {
    Icon: CheckCircle2,
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  failed: { Icon: AlertCircle, className: 'text-destructive' },
  waiting: {
    Icon: CirclePause,
    className: 'text-amber-600 dark:text-amber-400',
  },
  paused: {
    Icon: Bug,
    className: 'text-amber-600 dark:text-amber-400',
  },
  canceled: { Icon: XCircle, className: 'text-muted-foreground' },
};
