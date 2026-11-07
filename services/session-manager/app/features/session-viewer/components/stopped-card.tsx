import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { ContentArea } from '@tale/ui/content-area';
import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { LoaderCircle, RotateCw } from 'lucide-react';

import { useStatusLabel } from '@/app/features/sessions/components/session-status';
import { isIdle, shownStatus } from '@/app/features/sessions/lib/status';
import { sessionFailureText } from '@/app/lib/api/failure';
import { SPIN_CLASS, pendingIcon } from '@/app/lib/pending-icon';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useStartFlow } from '../hooks/use-start-flow';
import { busyButton } from '../lib/busy-button';
import { SessionDetails } from './session-details';

/** Errors about the proxy of the session: another proxy is the way on. */
const PROXY_ERRORS = new Set(['proxy_unreachable', 'unknown_ip_location']);
/** Errors that say there is no proxy to give: proxies have to be added. */
const NO_PROXY_ERRORS = new Set(['no_working_proxy', 'no_free_proxy']);

/**
 * The body of the page of a session whose browser is not running (stopped,
 * being started or stopped, or failed to start): what is wrong, if anything,
 * and the way on, then the details of the session. The page's header says
 * which session this is and what state it is in, so the card does not say
 * either again; it keeps the one thing the header cannot: that work is under
 * way.
 */
export function StoppedCard({
  session,
  onFocusLost,
}: {
  session: Session;
  /**
   * Where the keyboard goes when the card goes (the session started) while one
   * of its buttons had it: the page's heading.
   */
  onFocusLost?: () => void;
}) {
  const { t } = useT('viewer');
  const { t: tErrors } = useT('errors');
  const statusLabel = useStatusLabel();
  const flow = useStartFlow(session);
  const handoff = useFocusHandoff<HTMLDivElement>(onFocusLost);
  const shown = shownStatus(session);
  const busy =
    shown === 'assigning' || shown === 'starting' || shown === 'stopping';
  const code = session.errorCode;
  const errorText =
    session.error === null && code === null
      ? shown === 'error'
        ? t('card.couldNotStart')
        : null
      : // What the session carries with its error (the cause) is worded too. A
        // failure the app has no words for keeps the sentence the session
        // carries: it is what the person has to go on (why the browser did not
        // come up), where a refused call says the generic line.
        (sessionFailureText(session, tErrors) ??
        (session.error !== null && session.error !== ''
          ? session.error
          : tErrors('fallback')));
  const actionable = isIdle(session);
  const aboutProxy = code !== null && PROXY_ERRORS.has(code);
  const needsProxies = code !== null && NO_PROXY_ERRORS.has(code);
  // What starting does is news to a session that has not run yet: there is
  // nothing to reopen.
  const reopens = session.lastStartedAt !== null && shown === 'stopped';
  const wayOn = actionable && (aboutProxy || needsProxies);
  // The details are set off by a rule from what is said above them, and need
  // none when they stand alone.
  const saysSomething = busy || errorText !== null || wayOn;

  return (
    <ContentArea
      ref={handoff}
      className="min-h-0 flex-1 items-center overflow-auto"
    >
      {/* `my-auto`, not a centred parent: a card taller than the room starts at the top and scrolls. */}
      <Card className="my-auto flex w-full max-w-md flex-col gap-4">
        {/* What the page says about the session's trouble or work, in a status
            region that is always in the page (empty, and so gone from view,
            while there is nothing to say): a state that comes (starting,
            stopping, a start that failed) is read out. */}
        <div role="status" className="flex flex-col gap-2 text-sm empty:hidden">
          {busy && (
            <span className="text-muted-foreground flex items-center gap-2">
              <LoaderCircle
                className={cn('size-4', SPIN_CLASS)}
                aria-hidden="true"
              />
              {statusLabel(shown)}
            </span>
          )}
          {errorText !== null && (
            <Text variant="error" className="break-words">
              {errorText}
            </Text>
          )}
        </div>
        {/* The way on, when the trouble has one of its own. Starting the
            session is the header's: one Start for the page. */}
        {wayOn && (
          <div className="flex flex-wrap items-center gap-2">
            {aboutProxy && (
              <Button
                type="button"
                {...pendingIcon(flow.isRotating, RotateCw)}
                {...busyButton(flow.isRotating, flow.rotate)}
              >
                {t('actions.rotate')}
              </Button>
            )}
            {needsProxies && (
              <Button type="button" onClick={flow.addProxies}>
                {t('actions.addProxies')}
              </Button>
            )}
          </div>
        )}
        <div
          className={cn(
            'flex flex-col gap-4',
            saysSomething && 'border-border border-t pt-4',
          )}
        >
          <Heading level={2} size="sm">
            {t('details.title')}
          </Heading>
          <SessionDetails session={session} />
        </div>
        {reopens && <Text variant="caption">{t('card.hint')}</Text>}
      </Card>
    </ContentArea>
  );
}
