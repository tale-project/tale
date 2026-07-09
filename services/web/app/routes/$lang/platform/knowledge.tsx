import { createFileRoute } from '@tanstack/react-router';

import { KnowledgePage } from '@/app/pages/platform/knowledge-page';

export const Route = createFileRoute('/$lang/platform/knowledge')({
  component: KnowledgePage,
});
