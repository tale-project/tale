import { createFileRoute } from '@tanstack/react-router';

import { KnowledgePage } from '@/app/pages/platform/knowledge-page';

export const Route = createFileRoute('/platform/knowledge')({
  component: KnowledgePage,
});
