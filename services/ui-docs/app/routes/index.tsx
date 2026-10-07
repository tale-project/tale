import { createFileRoute } from '@tanstack/react-router';

import { DocPage } from '@/app/pages/doc-page';
import { docAnalyticsPath, ensureDocBody } from '@/lib/content/loader';
import { firstNavSlug } from '@/lib/content/nav';

export const Route = createFileRoute('/')({
  loader: async () => {
    const slug = firstNavSlug();
    await ensureDocBody(slug);
    return { analyticsPath: docAnalyticsPath(slug) };
  },
  component: () => <DocPage slug={firstNavSlug()} />,
});
