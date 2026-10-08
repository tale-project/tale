import { createFileRoute } from '@tanstack/react-router';

import { DocsPage } from '@/app/pages/docs-page';
import { ensureDocBody } from '@/lib/content/loader';
import { firstNavSlug } from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';

export const Route = createFileRoute('/')({
  loader: async () => {
    const slug = firstNavSlug();
    await ensureDocBody('en', slug);
    return { analyticsPath: docPath('en', slug) };
  },
  component: () => <DocsPage locale="en" slug={firstNavSlug()} />,
});
