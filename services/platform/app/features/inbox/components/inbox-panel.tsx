'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { CheckCheck, Inbox as InboxIcon } from 'lucide-react';
import { useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '../hooks/mutations';
import { useMyNotifications } from '../hooks/queries';

export function InboxPanel({ organizationId }: { organizationId: string }) {
  const { t } = useT('inbox');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { notifications, isLoading } = useMyNotifications(organizationId, {
    unreadOnly,
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  return (
    <ContentArea variant="narrow" gap={4} className="py-6">
      <StickySectionHeader
        title={t('title')}
        description={t('subtitle')}
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={unreadOnly ? 'secondary' : 'ghost'}
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly((v) => !v)}
            >
              {t('unreadOnly')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={CheckCheck}
              onClick={() => markAll.mutate({ organizationId })}
            >
              {t('markAllRead')}
            </Button>
          </div>
        }
      />

      {!isLoading && notifications.length === 0 ? (
        <EmptyState icon={InboxIcon} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-1">
          {notifications.map((notif) => {
            // `params` is the i18n interpolation map. The backend stores it as
            // `v.any()`, so narrow to the values `t()` accepts (no `unknown`,
            // which would make `t()` resolve to its object-returning overload).
            const params: Record<string, string | number> = notif.params ?? {};
            return (
              <li key={notif._id}>
                <button
                  type="button"
                  onClick={() => markRead.mutate({ notificationId: notif._id })}
                  className={cn(
                    'w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/30',
                    !notif.read && 'border-l-2 border-l-primary',
                  )}
                >
                  <Text as="p" variant="label">
                    {t(notif.titleKey)}
                  </Text>
                  <Text as="p" variant="muted" className="text-sm">
                    {t(notif.bodyKey, params)}
                  </Text>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ContentArea>
  );
}
