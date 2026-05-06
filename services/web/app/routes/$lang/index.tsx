import { createFileRoute } from '@tanstack/react-router';

import { HomePage } from '@/app/pages/home-page';

export const Route = createFileRoute('/$lang/')({
  component: HomePage,
});
