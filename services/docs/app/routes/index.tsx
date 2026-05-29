import { createFileRoute } from '@tanstack/react-router';

import { DocsPage } from '@/app/pages/docs-page';
import { ensureDocBody } from '@/lib/content/loader';

export const Route = createFileRoute('/')({
  loader: () => ensureDocBody('en', 'index'),
  component: () => <DocsPage locale="en" slug="index" />,
});
