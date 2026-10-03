import { createFileRoute, notFound } from '@tanstack/react-router';

import { MarketingContentPage } from '@/app/pages/marketing-content-page';
import { NotFoundPage } from '@/app/pages/not-found-page';
import { loadMarketingContent } from '@/lib/content/client';

export const Route = createFileRoute('/compare/')({
  loader: async () => {
    const document = await loadMarketingContent({
      category: 'comparisons',
      locale: 'en',
    });
    if (!document) throw notFound();
    return { document };
  },
  component: ContentRoute,
  notFoundComponent: NotFoundPage,
});

function ContentRoute() {
  const { document } = Route.useLoaderData();
  return <MarketingContentPage document={document} />;
}
