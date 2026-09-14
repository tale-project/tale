import { createFileRoute, notFound } from '@tanstack/react-router';

import { DocPage } from '@/app/pages/doc-page';
import { NotFoundPage } from '@/app/pages/not-found-page';
import { ensureDocBody, getDocPage } from '@/lib/content/loader';

/**
 * The markdown twin of every page (`/docs/components/button.md`) and the
 * artifact endpoints are served by the Bun server, not the router — but the
 * SPA fallback can still hand them here, so recognise and ignore them.
 */
function isSpecialEndpoint(splat: string): boolean {
  return splat.endsWith('.md');
}

function DocsSplatRoute() {
  const { _splat: splat = '' } = Route.useParams();
  return <DocPage slug={splat} />;
}

export const Route = createFileRoute('/docs/$')({
  beforeLoad: ({ params }) => {
    const splat = params._splat ?? '';
    if (isSpecialEndpoint(splat)) return;
    if (!getDocPage(splat)) throw notFound();
  },
  // Fetch only this page's body before it renders — one lazy chunk on the
  // client, resolved during `router.load()` on the server. The frontmatter the
  // rail and the breadcrumbs need is already in the manifest.
  loader: async ({ params }) => {
    const splat = params._splat ?? '';
    if (isSpecialEndpoint(splat)) return;
    await ensureDocBody(splat);
  },
  component: DocsSplatRoute,
  notFoundComponent: NotFoundPage,
});
