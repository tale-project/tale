import { createFileRoute } from '@tanstack/react-router';

import { PlatformHubPage } from '@/app/pages/platform/platform-hub-page';

export const Route = createFileRoute('/$lang/platform/')({
  component: PlatformHubPage,
});
