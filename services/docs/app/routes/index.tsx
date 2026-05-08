import { createFileRoute } from '@tanstack/react-router';

import { DocsPage } from '@/app/pages/docs-page';

export const Route = createFileRoute('/')({
  component: () => <DocsPage locale="en" slug="index" />,
});
