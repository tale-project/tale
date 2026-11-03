import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { LoadingOverlay } from '@tale/ui/loading-overlay';
import { useCopy } from '@tale/ui/use-copy';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { useToast } from '@tale/ui/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import { failureTextOfCode } from '@/app/lib/api/failure';
import { queryKeys } from '@/app/lib/api/keys';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useLiveView } from '../hooks/use-live-view';
import { useNoticeText } from '../hooks/use-notice-text';
import { AddressBar, type HistoryAction } from './address-bar';
import { LiveScreen } from './live-screen';
import { OutOfSyncBar } from './out-of-sync-bar';
import { PageDialogs } from './page-dialogs';
import { SecretsPopover } from './secrets-popover';
import { StoppedCard } from './stopped-card';
import { TabStrip, type ActivateSource } from './tab-strip';

/** How many connections fail in a row before the person is offered to connect at once. */
const OFFER_RETRY_AFTER = 2;

interface LiveStageProps {
  session: Session;
  /**
   * Where the keyboard goes when the stage goes (the session stopped, or its
   * browser closed) while the page had the keyboard: the page's heading. The
   * field that was typed into is gone with the stage, and the keyboard would
   * fall to the top of the document.
   */
  onFocusLost: () => void;
}

/**
 * The browser of a running session: its tabs and address bar, drawn here, and
 * under them what the active tab looks like, to click and type in. The browser
 * has no window; the server sends pictures of the active tab over a WebSocket
 * and the mouse and keyboard go back (see `useLiveView`).
 *
 * Mount it while the session runs, once per session: it connects when it
 * mounts and closes the connection when it unmounts.
 */
export function LiveStage({ session, onFocusLost }: LiveStageProps) {
  const { t } = useT('viewer');
  const { t: tCommon } = useT('common');
  const { t: tErrors } = useT('errors');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { copy } = useCopy();
  const noticeText = useNoticeText();
  const handoff = useFocusHandoff<HTMLDivElement>(onFocusLost);
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  // The browser is gone, or there is none to watch: the session will say what
  // became of it, ask now, so that the page does not say two things at once.
  const askSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    void queryClient.invalidateQueries({ queryKey: queryKeys.meta });
  }, [queryClient]);

  const live = useLiveView(session.id, {
    enabled: true,
    onClosed: askSession,
    onRefused: askSession,
    onNotice: (notice) =>
      toast({
        variant: 'destructive',
        title: t('notice.title'),
        description: noticeText(notice),
      }),
  });
  const { send, onSelection } = live;

  const focusPage = useCallback(
    () => sinkRef.current?.focus({ preventScroll: true }),
    [],
  );
  const focusAddress = useCallback(() => addressRef.current?.focus(), []);

  // The page's answer to a copy or a cut goes to this computer's clipboard.
  useEffect(
    () =>
      onSelection(({ text }) => {
        if (text) void copy(text);
      }),
    [onSelection, copy],
  );

  if (live.end?.reason === 'closed') {
    return <StoppedCard session={session} closed />;
  }

  const isLive = live.state === 'live';
  const activeUrl = live.tabs.find((tab) => tab.active)?.url;
  // Nothing is known of the browser yet: its place in the toolbar is kept.
  const firstConnection =
    !isLive && live.tabs.length === 0 && live.end === null;

  let notice: ReactNode = null;
  if (live.end?.reason === 'refused') {
    notice = (
      <div className="absolute inset-0 z-10 flex items-center justify-center overflow-auto">
        <EmptyState
          icon={CircleAlert}
          headingLevel={2}
          title={t('stage.refusedTitle')}
          description={failureTextOfCode(live.end.code, tErrors)}
          action={
            <Button type="button" variant="secondary" onClick={live.retry}>
              {tCommon('actions.tryAgain')}
            </Button>
          }
        />
      </div>
    );
  } else if (!isLive) {
    // The last picture stays under it, dimmed; the way to connect at once
    // comes when waiting has gone on for a while. The overlay is a live
    // region: once a connection has failed it keeps saying so for as long as
    // the page tries again (not "connecting" for the moment of each attempt),
    // so that an outage is announced once, not twice for every attempt.
    notice = (
      <>
        <LoadingOverlay
          message={live.failures > 0 ? t('stage.lost') : t('stage.connecting')}
        />
        {live.failures >= OFFER_RETRY_AFTER && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 mt-8 flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="pointer-events-auto"
              onClick={live.retry}
            >
              {tCommon('actions.tryAgain')}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    // On a phone the tab bar of the app floats over the page: the picture
    // stops above it (the room is none on a desktop).
    <div
      ref={handoff}
      className="flex min-h-0 flex-1 flex-col pb-[var(--mobile-nav-clearance-live,0px)]"
    >
      <div className="bg-background border-border shrink-0 border-b">
        {/* Two rows: the tabs, and the buttons, the address and the secrets.
            Where the window is too short for that (a phone held sideways),
            one row, which leaves the picture the room. The toolbar is the
            container its controls answer to: beside the rail and the list of
            sessions it is narrower than the window is. */}
        <div className="short-viewport:flex-row short-viewport:items-center @container/toolbar flex flex-col gap-2 px-3 py-2">
          <TabStrip
            tabs={live.tabs}
            disabled={!isLive}
            loading={firstConnection}
            className="short-viewport:max-w-1/3"
            onActivate={(id, source: ActivateSource) => {
              send({ t: 'tab', a: 'activate', id });
              if (source === 'pointer') focusPage();
            }}
            onClose={(id) => send({ t: 'tab', a: 'close', id })}
            onNew={() => {
              send({ t: 'tab', a: 'open' });
              focusAddress();
            }}
          />
          <AddressBar
            activeUrl={activeUrl}
            disabled={!isLive}
            inputRef={addressRef}
            className="short-viewport:min-w-0 short-viewport:flex-1"
            onNavigate={(action: HistoryAction) => send({ t: 'go', a: action })}
            onSubmit={(url) => send({ t: 'go', a: 'goto', url })}
            onLeave={() => {
              addressRef.current?.blur();
              focusPage();
            }}
          >
            <SecretsPopover
              sessionId={session.id}
              sessionName={session.name}
              disabled={!isLive}
              onType={(text) => send({ t: 'text', text })}
              returnFocus={focusPage}
            />
          </AddressBar>
        </div>
      </div>
      <OutOfSyncBar session={session} />
      <LiveScreen
        live={live}
        sinkRef={sinkRef}
        focusPage={focusPage}
        focusAddress={focusAddress}
        notice={notice}
      />
      <PageDialogs
        dialogs={live.dialogs}
        tabs={live.tabs}
        onAnswer={live.answerDialog}
        returnFocus={focusPage}
      />
    </div>
  );
}
