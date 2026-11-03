import { Button } from '@tale/ui/button';
import { Play, Square } from 'lucide-react';

import { useSessionActions } from '@/app/features/sessions/hooks/use-session-actions';
import { isIdle } from '@/app/features/sessions/lib/status';
import { pendingIcon } from '@/app/lib/pending-icon';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useStartFlow } from '../hooks/use-start-flow';

/**
 * Start while the session is idle, Stop while it runs or starts (and, off,
 * while it stops). The questions a start can raise are asked in dialogs by the
 * proxy flow.
 *
 * It is ONE button whose verb changes, not a Start and a Stop that replace
 * each other: the person who pressed it with the keyboard keeps the keyboard
 * through the whole turn, from "Start session" through "Starting" to "Stop
 * session". For the same reason a button that is at work is off but not
 * `disabled` (it stays in the tab order): `isLoading` would disable it natively
 * and drop the focus on the page. The reason it is off is its tooltip, which
 * is also why it always has one: a tooltip that came and went would swap the
 * button's element.
 */
export function StartStopButton({ session }: { session: Session }) {
  const { t } = useT('viewer');
  const { t: tSessions } = useT('sessions');
  const { stop } = useSessionActions();
  const flow = useStartFlow(session);
  const stoppable =
    session.status === 'running' ||
    session.status === 'starting' ||
    session.status === 'stopping';
  const stopping = session.status === 'stopping';
  const pending = stoppable
    ? stop.isPending || stopping
    : flow.isStarting || !isIdle(session);

  // Why the button cannot be pressed (undefined: it can).
  let reason: string | undefined;
  if (stopping) reason = tSessions('block.stopping');
  else if (pending) {
    reason = stoppable
      ? tSessions('status.stopping')
      : tSessions('status.starting');
  } else if (!stoppable && flow.blockedReason !== null) {
    reason = flow.blockedReason;
  }

  const label = stoppable ? t('actions.stop') : t('actions.start');
  return (
    <Button
      type="button"
      size="sm"
      variant={stoppable ? 'secondary' : 'primary'}
      {...pendingIcon(pending, stoppable ? Square : Play)}
      collapseLabel
      tooltip={label}
      aria-busy={pending || undefined}
      disabled={reason !== undefined}
      disabledReason={reason}
      onClick={() => {
        if (stoppable) stop.mutate({ id: session.id });
        else flow.start();
      }}
    >
      {label}
    </Button>
  );
}
