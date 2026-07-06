import { createFileRoute } from '@tanstack/react-router';

import { NotificationPreferencesSettings } from '@/app/features/settings/notifications/components/notification-preferences-settings';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/notifications')({
  head: () => ({
    meta: seo('notificationPreferences'),
  }),
  loader: ({ context, params }) => {
    void ensureConvexQuery(
      context,
      api.collab.preferences.getNotificationPreferences,
      { organizationId: params.id },
    ).catch(console.warn);
  },
  component: NotificationPreferencesPage,
});

function NotificationPreferencesPage() {
  return <NotificationPreferencesSettings />;
}
