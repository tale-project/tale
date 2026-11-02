import { IconButton } from '@tale/ui/icon-button';
import { Play, Square } from 'lucide-react';

import { pendingIcon } from '@/app/lib/pending-icon';
import { sessionIsBusy } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useBrowserBlock } from '../hooks/use-browser-block';
import { useProxyFlow } from '../hooks/use-proxy-flow';
import { useSessionActions } from '../hooks/use-session-actions';

interface SessionStartStopProps {
  session: Session;
  className?: string;
}

/**
 * The one button that starts a stopped session or stops a started one, named
 * by the session. A start that cannot go on yet is a question the proxy flow
 * asks in a dialog (no free proxy, the same exit IP as a running session, a
 * proxy that does not work); a session that is started opens, so its start
 * can be watched.
 */
export function SessionStartStop({
  session,
  className,
}: SessionStartStopProps) {
  const { t } = useT('sessions');
  const { stop } = useSessionActions();
  const flow = useProxyFlow();
  const browserBlock = useBrowserBlock();

  const stopped = session.status === 'stopped' || session.status === 'error';
  const pending = stopped ? flow.isStarting(session.id) : stop.isPending;

  // Why the button cannot be pressed (undefined: it can).
  let reason: string | undefined;
  if (pending) {
    reason = stopped ? t('status.starting') : t('status.stopping');
  } else if (stopped) {
    if (browserBlock !== null) reason = browserBlock;
    else if (sessionIsBusy(session)) reason = t('block.busy');
  } else if (session.status === 'stopping') {
    reason = t('block.stopping');
  }

  return (
    <IconButton
      {...pendingIcon(pending, stopped ? Play : Square)}
      size="sm"
      aria-label={
        stopped
          ? t('row.start', { name: session.name })
          : t('row.stop', { name: session.name })
      }
      aria-busy={pending || undefined}
      disabled={reason !== undefined}
      disabledReason={reason}
      className={className}
      onClick={() => {
        if (stopped) void flow.start(session);
        else stop.mutate({ id: session.id });
      }}
    />
  );
}
