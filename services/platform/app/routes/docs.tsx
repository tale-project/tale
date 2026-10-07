import { createFileRoute } from '@tanstack/react-router';

import { ApiDocsPage } from '@/app/features/api-docs/api-docs-page';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/docs')({
  head: () => ({
    meta: seo('apiDocs'),
  }),
  // Warm the (heavy) swagger-ui-react chunk during the loader so it's cached by
  // render time — removes the Suspense fallback flash on first visit.
  loader: () => {
    void import('swagger-ui-react').catch((error: unknown) => {
      console.warn('Failed to preload Swagger UI chunk', error);
    });
  },
  component: ApiDocsPage,
});
