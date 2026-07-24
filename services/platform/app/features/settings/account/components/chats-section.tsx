'use client';

import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';

/**
 * Account-settings section for bulk-managing the signed-in user's own chats
 * ("Archive all" / "Delete all"). The chat backend that stored threads is
 * offline while it is rewritten, so there is nothing these actions could act
 * on — the section stays in place with both controls disabled (the same state
 * they had with zero chats) and re-arms when the chat rebuild lands.
 */
export function ChatsSection() {
  const { t } = useT('settings');

  return (
    <SettingsSection
      title={t('account.chats.title')}
      description={t('account.chats.description')}
      action={
        <HStack gap={2}>
          <Button variant="secondary" disabled>
            {t('account.chats.archiveAll')}
          </Button>
          <Button variant="destructive" disabled>
            {t('account.chats.deleteAll')}
          </Button>
        </HStack>
      }
    />
  );
}
