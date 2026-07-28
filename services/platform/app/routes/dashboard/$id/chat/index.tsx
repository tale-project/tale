import { createFileRoute } from '@tanstack/react-router';

/**
 * A conversation that has not been started yet. The surface itself is
 * rendered by the parent layout route (so the first send's index →
 * `$threadId` navigation never remounts it); this route contributes only the
 * search contract.
 */
export const Route = createFileRoute('/dashboard/$id/chat/')({
  // The project's "New chat" flow arrives as `?projectId=…` — kept through
  // validation so the first send creates a project-linked thread. The
  // property stays OPTIONAL (absent, never `undefined`) so plain links and
  // redirects to /chat need no `search` argument.
  validateSearch: (search: Record<string, unknown>): { projectId?: string } =>
    typeof search.projectId === 'string' && search.projectId !== ''
      ? { projectId: search.projectId }
      : {},
  component: () => null,
});
