import { createFileRoute, redirect } from '@tanstack/react-router';

// Clicking "Agents" lands on the List (the roster of every agent) — the most
// actionable default. Catalog and Metrics are sibling tabs. The list lives at
// ./all so this index is a thin redirect.
export const Route = createFileRoute('/dashboard/$id/agents/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/agents/all',
      params: { id: params.id },
    });
  },
});
