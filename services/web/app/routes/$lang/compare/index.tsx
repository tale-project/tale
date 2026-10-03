import { createFileRoute, notFound } from '@tanstack/react-router';

import { MarketingContentPage } from '@/app/pages/marketing-content-page';
import { loadMarketingContent } from '@/lib/content/client';

export const Route = createFileRoute('/$lang/compare/')({
  loader: async ({ params }) => {
    const document = await loadMarketingContent({
      category: 'comparisons',
      locale: params.lang,
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
