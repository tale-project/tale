import { createFileRoute } from '@tanstack/react-router';

import { ChatSurface } from '@/app/features/chat/components/chat-surface';

export const Route = createFileRoute('/dashboard/$id/chat/')({
  // The project's "New chat" flow arrives as `?projectId=…` — kept through
  // validation so the first send creates a project-linked thread. The
  // property stays OPTIONAL (absent, never `undefined`) so plain links and
  // redirects to /chat need no `search` argument.
  validateSearch: (search: Record<string, unknown>): { projectId?: string } =>
    typeof search.projectId === 'string' && search.projectId !== ''
      ? { projectId: search.projectId }
      : {},
  component: ChatIndexRoute,
});

/** A conversation that has not been started yet — no thread, full surface. */
function ChatIndexRoute() {
  const { id } = Route.useParams();
  const { projectId } = Route.useSearch();
  return (
    <ChatSurface
      organizationId={id}
      {...(projectId !== undefined ? { projectId } : {})}
    />
  );
}
