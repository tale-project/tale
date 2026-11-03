import { Button } from '@tale/ui/button';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { ThreadHeader, ThreadHeaderSeparator } from '@tale/ui/thread-header';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { Ref } from 'react';

import { SessionActionsMenu } from '@/app/features/sessions/components/session-actions-menu';
import { SessionStatus } from '@/app/features/sessions/components/session-status';
import { shownStatus } from '@/app/features/sessions/lib/status';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { exitOf } from '../lib/exit-of';
import { IdentityChip } from './identity-chip';
import { StartStopButton } from './start-controls';

interface SessionHeaderProps {
  /** Undefined while the session is read, and when it could not be. */
  session: Session | undefined;
  /** The read failed: there is no session to name and nothing to wait for. */
  failed?: boolean;
  /** The session was deleted from its menu. */
  onDeleted?: () => void;
  /** The heading of the page: where the keyboard goes when what it was on is gone. */
  titleRef?: Ref<HTMLHeadingElement>;
}

/**
 * The head of a session's page, as every thread of the platform has its own
 * (`ThreadHeader`, as a task or a conversation has): the session's name as the
 * page's one heading, one line of context under it (its state, and where it
 * exits, the chip that opens its details), and on the right Start or Stop and
 * the menu with the rest of what can be done to a session. The section is not
 * named here: the panel beside the page does that, and a phone has the way
 * back instead.
 *
 * While the session is read the same row stands masked, and only the way back
 * is live. When it could not be read the row names the page and keeps the way
 * back: it does not go on saying that it is loading.
 */
export function SessionHeader({
  session,
  failed = false,
  onDeleted,
  titleRef,
}: SessionHeaderProps) {
  const { t } = useT('viewer');
  const loading = session === undefined && !failed;

  return (
    // The wrapper is there in every state, so that nothing is mounted anew
    // when the session arrives.
    <Skeletonize loading={loading} label={t('loading')} className="contents">
      <ThreadHeader
        // The way back never waits for the session.
        before={
          <Skeletonize loading={false} className="contents">
            <BackToSessions />
          </Skeletonize>
        }
        title={
          session !== undefined ? (
            <h1
              ref={titleRef}
              tabIndex={-1}
              className={TITLE_CLASS}
              title={session.name}
            >
              {session.name}
            </h1>
          ) : failed ? (
            <h1 ref={titleRef} tabIndex={-1} className={TITLE_CLASS}>
              {t('title')}
            </h1>
          ) : (
            <h1 ref={titleRef} tabIndex={-1} className={TITLE_CLASS}>
              <span className="block w-48 max-w-full">
                <SkeletonText />
              </span>
              <span className="sr-only">{t('loading')}</span>
            </h1>
          )
        }
        meta={
          session !== undefined ? (
            <SessionContext session={session} />
          ) : failed ? undefined : (
            <span className="block w-40 max-w-full">
              <SkeletonText seed={1} />
            </span>
          )
        }
        actions={
          session !== undefined ? (
            <>
              <StartStopButton session={session} />
              <SessionActionsMenu session={session} onDeleted={onDeleted} />
            </>
          ) : failed ? undefined : (
            <>
              <SkeletonBox asChild>
                <div className="h-8 w-8 rounded-md sm:w-28" />
              </SkeletonBox>
              <SkeletonBox asChild>
                <div className="size-8 rounded-md" />
              </SkeletonBox>
            </>
          )
        }
      />
    </Skeletonize>
  );
}

/** The heading takes the keyboard when a page that had it is gone, and draws no ring for it. */
const TITLE_CLASS = 'truncate outline-none';

/**
 * Back to the list, on a phone, which has no panel to choose another session
 * in. A desktop never shows it. Mirrors the platform's
 * `features/home/components/home-back-button.tsx`.
 */
function BackToSessions() {
  const { t } = useT('common');
  return (
    <Button
      asChild
      size="icon"
      variant="ghost"
      aria-label={t('aria.back')}
      className="text-muted-foreground -ml-1.5 size-8 shrink-0 md:hidden"
    >
      {/* Exact: the section the page is in is not the page that is open, and
          the link would say so (`aria-current`) for every address under it. */}
      <Link to="/sessions" activeOptions={{ exact: true }}>
        <ArrowLeft className="size-5" />
      </Link>
    </Button>
  );
}

/**
 * The line of context under the name: the state, then where the session
 * exits. Each keeps its whole width, and one that no longer fits wraps onto a
 * second line this row clips away, so a narrow header drops the least
 * important item instead of cutting every one down to a letter. Mirrors the
 * context line of the platform's
 * `features/conversations/components/conversation-header.tsx`.
 */
function SessionContext({ session }: { session: Session }) {
  const hasExit = exitOf(session) !== null;
  return (
    <span className="-m-1 flex h-6 min-w-0 flex-1 flex-wrap content-start items-center gap-x-1.5 gap-y-2 overflow-hidden p-1">
      <SessionStatus
        status={shownStatus(session)}
        className="shrink-0 text-xs"
      />
      {hasExit && (
        <>
          <ThreadHeaderSeparator />
          <IdentityChip session={session} />
        </>
      )}
    </span>
  );
}
