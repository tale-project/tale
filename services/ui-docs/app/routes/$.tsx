import { createFileRoute } from '@tanstack/react-router';

import { NotFoundPage } from '@/app/pages/not-found-page';

/**
 * Everything that is neither the home page nor a documentation page. The
 * prerenderer renders `/404` through this route so the Bun server can answer
 * a real 404 with the same chrome the SPA shows.
 */
export const Route = createFileRoute('/$')({
  component: NotFoundPage,
});
