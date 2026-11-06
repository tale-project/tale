import { createFileRoute } from '@tanstack/react-router';

import { SessionPage } from '@/app/features/session-viewer/components/session-page';
import { sessionQuery } from '@/app/features/sessions/hooks/use-session';
import { ApiError } from '@/app/lib/api/client';
import { pageHead } from '@/app/lib/page-head';
import { waitForRead } from '@/app/lib/route-read';
import { parseSessionId } from '@/app/lib/session-id';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/sessions/$sessionId')({
  // The session is in before the page's first frame: its header and what
  // stands under it (its browser, the card of a stopped one, or the word that
  // it does not exist) are drawn from it, and appear at once instead of after a
  // masked header. One row that decides what renders, waited for as the root
  // route's read is. A read that fails is for the page to tell; one of a
  // session that does not exist is an answer, not a failure.
  loader: ({ context, params }) => {
    const id = parseSessionId(params.sessionId);
    if (id === null) return undefined;
    return waitForRead(
      context.queryClient.ensureQueryData(
        sessionQuery(context.queryClient, id),
      ),
      (error: unknown) => {
        if (error instanceof ApiError && error.code === 'session_not_found') {
          return;
        }
        console.warn('Failed to load the session', error);
      },
    );
  },
  // TanStack Router can draw this page while its loader still waits: a
  // navigation that interrupts another commits the newer one's matches before
  // they have loaded. Such a page suspends, and a route with no boundary of its
  // own suspends the root's, which hid the list of sessions beside it, and the
  // row the keyboard was on, for half a second (`pendingMinMs`). Its own
  // boundary leaves the list as it is and holds this page's place only until
  // its read is in.
  wrapInSuspense: true,
  pendingMinMs: 0,
  head: () => pageHead(i18n.t('viewer:title')),
  component: SessionRoute,
});

function SessionRoute() {
  const { sessionId } = Route.useParams();
  // An address that is no id (`/sessions/abc`) names no session.
  return <SessionPage sessionId={parseSessionId(sessionId)} />;
}
