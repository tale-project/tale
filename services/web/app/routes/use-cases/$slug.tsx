import { createFileRoute, notFound } from '@tanstack/react-router';

import { MarketingContentPage } from '@/app/pages/marketing-content-page';
import { loadMarketingContent } from '@/lib/content/client';

export const Route = createFileRoute('/use-cases/$slug')({
  loader: async ({ params }) => {
    if (params.slug === 'index') throw notFound();
    const document = await loadMarketingContent({
      category: 'use-cases',
      locale: 'en',
      slug: params.slug,
    });
    if (!document) throw notFound();
    return { document };
  },
  component: ContentRoute,
});

function ContentRoute() {
  const { document } = Route.useLoaderData();
  return <MarketingContentPage document={document} />;
}
