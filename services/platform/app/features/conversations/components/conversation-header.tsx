'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuItem } from '@tale/ui/dropdown-menu';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  ArrowLeft,
  Ellipsis,
  MessageSquare,
  MessageSquareOff,
  ShieldX,
  UserIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ContactInfoPopover } from '@/app/features/contacts/components/contact-info-popover';
import {
  useContactById,
  useContacts,
} from '@/app/features/contacts/hooks/queries';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import {
  useCloseConversation,
  useMarkAsSpam,
  useReopenConversation,
} from '../hooks/mutations';
import type { ConversationWithMessages } from '../types';
import { DotIcon } from './dot-icon';

interface ConversationHeaderProps {
  conversation: ConversationWithMessages;
  organizationId: string;
  onResolve?: () => void;
  onReopen?: () => void;
  onBack?: () => void;
}

export function ConversationHeader({
  conversation,
  organizationId,
  onResolve,
  onReopen,
  onBack,
}: ConversationHeaderProps) {
  const { t } = useT('conversations');
  const { t: tCommon } = useT('common');
  const { contact } = conversation;
  const [isContactInfoOpen, setIsContactInfoOpen] = useState(false);
  const pendingContactInfo = useRef(false);
  const { formatRelative } = useFormatDate();

  const { mutate: closeConversation, isPending: isClosing } =
    useCloseConversation();
  const { mutate: reopenConversation, isPending: isReopening } =
    useReopenConversation();
  const { mutate: markAsSpamMutation, isPending: isMarkingSpam } =
    useMarkAsSpam();
  const isLoading = isClosing || isReopening || isMarkingSpam;

  const { contacts } = useContacts(organizationId);
  const contactDoc = useContactById(contacts, conversation.contactId);

  const handleResolveConversation = useCallback(() => {
    closeConversation(
      { conversationId: toId<'conversations'>(conversation.id) },
      {
        onSuccess: () => {
          toast({
            title: t('header.toast.closed'),
            variant: 'success',
          });
          onResolve?.();
        },
        onError: (error) => {
          console.error('Error closing conversation:', error);
          toast({
            title: t('header.toast.closeFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [closeConversation, conversation.id, t, onResolve]);

  const handleReopenConversation = useCallback(() => {
    reopenConversation(
      { conversationId: toId<'conversations'>(conversation.id) },
      {
        onSuccess: () => {
          toast({
            title: t('header.toast.reopened'),
            variant: 'success',
          });
          onReopen?.();
        },
        onError: (error) => {
          console.error('Error reopening conversation:', error);
          toast({
            title: t('header.toast.reopenFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [reopenConversation, conversation.id, t, onReopen]);

  const handleMarkAsSpam = useCallback(() => {
    markAsSpamMutation(
      { conversationId: toId<'conversations'>(conversation.id) },
      {
        onSuccess: () => {
          toast({
            title: t('header.toast.markedAsSpam'),
            variant: 'success',
          });
          onResolve?.();
        },
        onError: (error) => {
          console.error('Error marking conversation as spam:', error);
          toast({
            title: t('header.toast.markAsSpamFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [markAsSpamMutation, conversation.id, t, onResolve]);

  const contactData = contactDoc ?? conversation.contact;

  const moreMenuItems = useMemo<DropdownMenuItem[]>(() => {
    const items: DropdownMenuItem[] = [
      {
        type: 'item',
        label: t('header.contactInfo'),
        icon: UserIcon,
        onClick: () => {
          pendingContactInfo.current = true;
        },
        disabled: isLoading,
      },
    ];

    if (conversation.status === 'open') {
      items.push({
        type: 'item',
        label: isClosing ? t('header.closing') : t('header.closeConversation'),
        icon: MessageSquareOff,
        onClick: handleResolveConversation,
        disabled: isLoading,
      });
    }

    if (conversation.status !== 'open') {
      items.push({
        type: 'item',
        label: isReopening
          ? t('header.reopening')
          : t('header.reopenConversation'),
        icon: MessageSquare,
        onClick: handleReopenConversation,
        disabled: isLoading,
      });
    }

    if (conversation.status === 'open') {
      items.push({
        type: 'item',
        label: isMarkingSpam
          ? t('header.markingAsSpam')
          : t('header.markAsSpam'),
        icon: ShieldX,
        onClick: handleMarkAsSpam,
        disabled: isLoading,
      });
    }

    return items;
  }, [
    t,
    isLoading,
    isClosing,
    isReopening,
    isMarkingSpam,
    conversation.status,
    handleResolveConversation,
    handleReopenConversation,
    handleMarkAsSpam,
  ]);

  const handleDropdownOpenChange = useCallback((open: boolean) => {
    if (!open && pendingContactInfo.current) {
      pendingContactInfo.current = false;
      setTimeout(() => setIsContactInfoOpen(true), 0);
    }
  }, []);

  const initial = (contact.name ?? contact.email ?? '?')
    .charAt(0)
    .toUpperCase();

  const lastMessageTime = conversation.last_message_at
    ? formatRelative(new Date(conversation.last_message_at))
    : null;

  return (
    <Stack gap={3} className="border-border border-b p-4 sm:px-6 sm:py-4">
      {/* Back button - visible only on mobile */}
      {onBack && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={onBack}
          title={tCommon('actions.back')}
        >
          <ArrowLeft className="size-5" />
        </Button>
      )}

      {/* Subject Row */}
      <Row justify="between">
        <Text className="min-w-0 truncate text-base font-semibold tracking-tight">
          {conversation.subject || conversation.title}
        </Text>
        <Row gap={1} className="shrink-0">
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t('header.moreActions')}
              >
                <Ellipsis className="text-muted-foreground size-4" />
              </Button>
            }
            items={[moreMenuItems]}
            align="end"
            onOpenChange={handleDropdownOpenChange}
          />
        </Row>
      </Row>

      {/* Sender Row */}
      <div className="flex items-center gap-2.5">
        <ContactInfoPopover
          contact={contactData}
          open={isContactInfoOpen}
          onOpenChange={setIsContactInfoOpen}
          trigger={
            <button
              type="button"
              className="bg-muted flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full"
              aria-label={t('header.contactInfo')}
            >
              <span className="text-muted-foreground text-[13px] font-semibold">
                {initial}
              </span>
            </button>
          }
        />
        <div className="flex min-w-0 flex-col gap-px">
          <button
            type="button"
            className="cursor-pointer text-left text-[13px] font-semibold tracking-tight hover:underline"
            onClick={() => setIsContactInfoOpen(true)}
          >
            {contact.name || contact.email}
          </button>
          <Row gap={0} className="text-muted-foreground text-xs tracking-tight">
            <button
              type="button"
              className="cursor-pointer hover:underline"
              onClick={() => setIsContactInfoOpen(true)}
            >
              {contact.email}
            </button>
            {lastMessageTime && (
              <>
                <DotIcon className="mx-0.5 shrink-0" />
                <span>{lastMessageTime}</span>
              </>
            )}
          </Row>
        </div>
      </div>
    </Stack>
  );
}
