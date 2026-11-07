import { Button, LinkButton } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { ContentArea } from '@tale/ui/content-area';
import { EmptyState } from '@tale/ui/empty-state';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useFocusHandoff } from '@tale/ui/use-focus-handoff';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert, Loader2, SearchX } from 'lucide-react';
import { useRef } from 'react';

import { useSession } from '@/app/features/sessions/hooks/use-session';
import { useDocumentTitle } from '@/app/hooks/use-document-title';
import { ApiError } from '@/app/lib/api/client';
import { readFailureCause } from '@/app/lib/api/failure';
import { focusMainArea } from '@/app/lib/main-area';
import { documentTitle } from '@/app/lib/page-head';
import { SPIN_CLASS } from '@/app/lib/pending-icon';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useLastError } from '../hooks/use-last-error';
import { busyButton } from '../lib/busy-button';
import { SessionHeader } from './session-header';
import { StoppedCard } from './stopped-card';
import { WindowCard } from './window-card';

/**
 * The page of one session: its header, and under it a card that says where
 * the session stands and how to go on (while it runs, its window). A session
 * that does not exist, or is gone, says so. `null` is an address that names no
 * session at all.
 */
export function SessionPage({ sessionId }: { sessionId: number | null }) {
  return sessionId === null ? (
    <SessionGone />
  ) : (
    // Another session is another page: nothing of the last one carries over.
    <OpenSession key={sessionId} sessionId={sessionId} />
  );
}

function OpenSession({ sessionId }: { sessionId: number }) {
  const navigate = useNavigate();
  // The page can leave while the keyboard is on it: the session was deleted
  // from the menu of its header, and the list (which may have to be fetched
  // first) takes its place, with the menu button the keyboard went back to
  // gone. The keyboard goes to the main area, not to the top of the document.
  const handoff = useFocusHandoff<HTMLDivElement>(focusMainArea);
  const query = useSession(sessionId);
  const session = query.data;
  // Asked again, a read that never worked reads as loading: what failed stays.
  const error = useLastError(query.error);
  const title = useRef<HTMLHeadingElement>(null);
  // The tab names the session, so that several open ones stay apart in the
  // browser's list of tabs; until it is known the page's own title stands.
  useDocumentTitle(
    session === undefined ? undefined : documentTitle(session.name),
  );

  if (error instanceof ApiError && error.code === 'session_not_found') {
    return <SessionGone />;
  }

  const failed = session === undefined && error !== null;
  return (
    <div ref={handoff} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SessionHeader
        session={session}
        failed={failed}
        titleRef={title}
        onDeleted={() => void navigate({ to: '/sessions' })}
      />
      <SessionBody
        session={session}
        failed={failed}
        error={error}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
        // What a read that worked takes the retry button away from: the page
        // is named by its title, which is where the person goes on.
        onFocusLost={() => title.current?.focus()}
      />
    </div>
  );
}

function SessionBody({
  session,
  failed,
  error,
  retrying,
  onRetry,
  onFocusLost,
}: {
  session: Session | undefined;
  failed: boolean;
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
  onFocusLost: () => void;
}) {
  const { t } = useT('viewer');
  const { t: tCommon } = useT('common');
  const { t: tErrors } = useT('errors');
  const handoff = useFocusHandoff<HTMLDivElement>(onFocusLost);

  if (session !== undefined) {
    return session.status === 'running' ? (
      <WindowCard session={session} onFocusLost={onFocusLost} />
    ) : (
      <StoppedCard session={session} onFocusLost={onFocusLost} />
    );
  }

  if (failed) {
    return (
      <ContentArea ref={handoff} className="min-h-0 flex-1">
        <EmptyState
          icon={CircleAlert}
          headingLevel={2}
          title={t('loadFailed.title')}
          description={readFailureCause(error, tErrors) ?? undefined}
          action={
            <Button
              type="button"
              variant="secondary"
              icon={retrying ? Loader2 : undefined}
              iconClassName={SPIN_CLASS}
              {...busyButton(retrying, onRetry)}
            >
              {tCommon('actions.tryAgain')}
            </Button>
          }
        />
      </ContentArea>
    );
  }

  return <LoadingCard />;
}

/** What stands where the card of the session will be, while the session is read. */
function LoadingCard() {
  const { t } = useT('viewer');
  return (
    <ContentArea className="min-h-0 flex-1 items-center overflow-auto">
      <Skeletonize
        loading
        label={t('loading')}
        className="my-auto w-full max-w-md"
      >
        <Card className="flex w-full flex-col items-center gap-4">
          <SkeletonBox>
            <span className="inline-block h-7 w-40" />
          </SkeletonBox>
          <SkeletonBox>
            <span className="inline-block h-5 w-24" />
          </SkeletonBox>
          <SkeletonBox>
            <span className="inline-block h-9 w-36" />
          </SkeletonBox>
          <SkeletonBox fullWidth>
            <span className="block h-24 w-full" />
          </SkeletonBox>
        </Card>
      </Skeletonize>
    </ContentArea>
  );
}

/** A session that does not exist (a wrong address) or that was deleted while its page was open. */
function SessionGone() {
  const { t } = useT('viewer');
  const handoff = useFocusHandoff<HTMLDivElement>(focusMainArea);
  useDocumentTitle(documentTitle(t('gone.title')));
  return (
    <div ref={handoff} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SessionHeader session={undefined} failed />
      <ContentArea className="min-h-0 flex-1">
        <EmptyState
          icon={SearchX}
          headingLevel={2}
          title={t('gone.title')}
          description={t('gone.description')}
          action={
            <LinkButton href="/sessions" variant="secondary">
              {t('gone.back')}
            </LinkButton>
          }
        />
      </ContentArea>
    </div>
  );
}
