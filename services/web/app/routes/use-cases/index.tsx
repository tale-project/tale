import { createFileRoute, notFound } from '@tanstack/react-router';

import { MarketingContentPage } from '@/app/pages/marketing-content-page';
import { loadMarketingContent } from '@/lib/content/client';

export const Route = createFileRoute('/use-cases/')({
  loader: async () => {
    const document = await loadMarketingContent({
      category: 'use-cases',
      locale: 'en',
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
