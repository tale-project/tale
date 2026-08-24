import { createFileRoute } from '@tanstack/react-router';

/**
 * Chat index: either a fresh composer (`?new=1` / `?projectId=…`) or a
 * resume target (the layout redirects to the caller's most recent thread).
 * The surface itself is rendered by the parent layout route (so the first
 * send's index → `$threadId` navigation never remounts it); this route
 * contributes only the search contract.
 */
export type ChatIndexSearch = {
  projectId?: string;
  /** Explicit fresh composer — skips the resume-to-last-chat redirect. */
  new?: true;
};

export const Route = createFileRoute('/dashboard/$id/chat/')({
  // `projectId` — project's "New chat" flow; first send creates a
  // project-linked thread. `new` — header / shortcut / empty-state fresh
  // chat. Both stay OPTIONAL (absent, never `undefined`) so plain links and
  // redirects to /chat need no `search` argument.
  validateSearch: (search: Record<string, unknown>): ChatIndexSearch => {
    const next: ChatIndexSearch = {};
    if (typeof search.projectId === 'string' && search.projectId !== '') {
      next.projectId = search.projectId;
    }
    if (search.new === true || search.new === '1' || search.new === 'true') {
      next.new = true;
    }
    return next;
  },
  component: () => null,
});
