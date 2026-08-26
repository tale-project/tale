import { createFileRoute } from '@tanstack/react-router';

import { AboutPage } from '@/app/pages/about-page';

export const Route = createFileRoute('/$lang/about')({
  component: AboutPage,
});
