import { createFileRoute, notFound } from '@tanstack/react-router';

import { DocPage } from '@/app/pages/doc-page';
import { NotFoundPage } from '@/app/pages/not-found-page';
import {
  docAnalyticsPath,
  ensureDocBody,
  getDocPage,
} from '@/lib/content/loader';

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
  //
  // `analyticsPath` is the page's CANONICAL path, and it is what `main.tsx`
  // reports as a pageview. Deriving it here rather than from the browser's
  // location is what keeps a scanner's URL, a `.md` twin and a 404 out of the
  // reports: this loader only runs, and only returns, for a page that resolved.
  loader: async ({ params }) => {
    const splat = params._splat ?? '';
    if (isSpecialEndpoint(splat)) return undefined;
    await ensureDocBody(splat);
    const analyticsPath = docAnalyticsPath(splat);
    return analyticsPath ? { analyticsPath } : undefined;
  },
  component: DocsSplatRoute,
  notFoundComponent: NotFoundPage,
});
