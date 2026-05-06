import { createFileRoute } from '@tanstack/react-router';

import { RequestDemoPage } from '@/app/pages/request-demo-page';

export const Route = createFileRoute('/$lang/request-demo')({
  component: RequestDemoPage,
});
