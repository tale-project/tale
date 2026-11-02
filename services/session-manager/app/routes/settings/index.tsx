import { createFileRoute } from '@tanstack/react-router';

import { SettingsIndexPage } from '@/app/features/settings/components/settings-index-page';
import { openFirstPageOnDesktop } from '@/app/features/settings/lib/first-page';

export const Route = createFileRoute('/settings/')({
  // Settings opens on its first page on a computer; a phone, which has no panel
  // to choose a page in, gets the list of pages.
  beforeLoad: () => openFirstPageOnDesktop(),
  component: SettingsIndexPage,
});
