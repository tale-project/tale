import { createFileRoute } from '@tanstack/react-router';

import { SessionPage } from '@/app/features/session-viewer/components/session-page';
import { pageHead } from '@/app/lib/page-head';
import { parseSessionId } from '@/app/lib/session-id';
import { i18n } from '@/lib/i18n/i18n';

export const Route = createFileRoute('/sessions/$sessionId')({
  head: () => pageHead(i18n.t('viewer:title')),
  component: SessionRoute,
});

function SessionRoute() {
  const { sessionId } = Route.useParams();
  // An address that is no id (`/sessions/abc`) names no session.
  return <SessionPage sessionId={parseSessionId(sessionId)} />;
}
