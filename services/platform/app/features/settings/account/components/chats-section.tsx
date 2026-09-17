'use client';

import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { HStack } from '@tale/ui/layout';
import { toast } from '@tale/ui/use-toast';
import { useRef, useState } from 'react';

import { useChatQueryClient } from '@/app/features/chat/data/chat-backend';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import {
  bulkUpdateChatThreads,
  invalidateChatThreads,
} from '@/app/lib/backend/chat';
import { useT } from '@/lib/i18n/client';

/**
 * Account-settings section for bulk-managing the signed-in user's own chats
 * ("Archive all" / "Delete all") within the current organization.
 */
export function ChatsSection() {
  const { t } = useT('settings');
  const organizationId = useOrganizationId();
  const queryClient = useChatQueryClient();
  const [operation, setOperation] = useState<'archive' | 'trash' | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const confirm = async () => {
    if (!organizationId || operation === null || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const result = await bulkUpdateChatThreads(organizationId, operation);
      invalidateChatThreads(queryClient, organizationId);
      toast({
        title: t('account.chats.result', result),
        ...(result.failed > 0 ? { variant: 'destructive' as const } : {}),
      });
      setOperation(null);
    } catch {
      toast({ title: t('account.chats.failed'), variant: 'destructive' });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <SettingsSection
        title={t('account.chats.title')}
        description={t('account.chats.description')}
        action={
          <HStack gap={2}>
            <Button
              variant="secondary"
              disabled={!organizationId || pending}
              onClick={() => setOperation('archive')}
            >
              {t('account.chats.archiveAll')}
            </Button>
            <Button
              variant="destructive"
              disabled={!organizationId || pending}
              onClick={() => setOperation('trash')}
            >
              {t('account.chats.deleteAll')}
            </Button>
          </HStack>
        }
      />
      <ConfirmDialog
        open={operation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setOperation(null);
        }}
        title={t(
          operation === 'archive'
            ? 'account.chats.archiveAll'
            : 'account.chats.deleteAll',
        )}
        description={t(
          operation === 'archive'
            ? 'account.chats.archiveConfirm'
            : 'account.chats.deleteConfirm',
        )}
        confirmText={t(
          operation === 'archive'
            ? 'account.chats.archiveAll'
            : 'account.chats.deleteAll',
        )}
        variant={operation === 'trash' ? 'destructive' : 'default'}
        isLoading={pending}
        onConfirm={confirm}
      />
    </>
  );
}
