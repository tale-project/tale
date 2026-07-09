import { createFileRoute } from '@tanstack/react-router';

import { ChangelogPage } from '@/app/pages/changelog-page';

export const Route = createFileRoute('/$lang/changelog')({
  component: ChangelogPage,
});
