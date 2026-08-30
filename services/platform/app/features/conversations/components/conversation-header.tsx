'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuItem } from '@tale/ui/dropdown-menu';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  Ellipsis,
  Mail,
  MessageSquare,
  MessageSquareOff,
  ShieldX,
  UserIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { ContactInfoPopover } from '@/app/features/contacts/components/contact-info-popover';
import {
  useContactById,
  useContacts,
} from '@/app/features/contacts/hooks/queries';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import {
  mailboxSideAddress,
  resolveReplyFrom,
} from '@/convex/conversations/reply_from';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import {
  useCloseConversation,
  useMarkAsSpam,
  useReopenConversation,
} from '../hooks/mutations';
import { useEmailConnectors } from '../hooks/queries';
import type { ConversationWithMessages } from '../types';
import { ConversationAssigneePicker } from './conversation-assignee-picker';
import { DotIcon } from './dot-icon';

interface ConversationHeaderProps {
  conversation: ConversationWithMessages;
  organizationId: string;
  onResolve?: () => void;
  onReopen?: () => void;
}

export function ConversationHeader({
  conversation,
  organizationId,
  onResolve,
  onReopen,
}: ConversationHeaderProps) {
  const { t } = useT('conversations');
  const { contact } = conversation;
  const [isContactInfoOpen, setIsContactInfoOpen] = useState(false);
  const pendingContactInfo = useRef(false);
  const { formatRelative } = useFormatDate();

  // Which of the org's mailboxes THIS thread belongs to — read from the side of
  // the envelope that is ours (`mailboxSideAddress`: the recipient on inbound
  // mail, the sender on sent-folder mail we synced back, where `metadata.to` is
  // the contact). Reading `to` blindly is what made an unconnected personal
  // address look like the inbox source on outbound threads. With a configured
  // From (imap_smtp mirrors the login) `resolveReplyFrom` keeps the mailbox
  // address unless the thread ran on a genuine same-domain alias; gmail/outlook
  // expose no From, so the envelope's own address stands on its own.
  const { emailConnectors } = useEmailConnectors(organizationId);
  const inbox = conversation.connectorName
    ? emailConnectors.find((i) => i.slug === conversation.connectorName)
    : undefined;
  const ourAddress = mailboxSideAddress(
    isRecord(conversation.metadata) ? conversation.metadata : undefined,
    conversation.direction,
  );
  const conversationFrom = inbox?.fromAddress
    ? resolveReplyFrom(ourAddress, inbox.fromAddress)
    : ourAddress;
  const inboxLabel = inbox?.title;

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
      { conversationId: conversation.id },
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
      { conversationId: conversation.id },
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
      { conversationId: conversation.id },
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

  // Primary line prefers a display name; when the contact has none, it already
  // shows the email — repeating it on the meta line is noise and eats width.
  const primaryLabel = contact.name || contact.email;
  const showEmailInMeta = Boolean(contact.name && contact.email);

  return (
    <Stack gap={3} className="border-border border-b p-4 sm:px-6 sm:py-4">
      {/* Subject Row */}
      <Row justify="between" gap={2} className="min-w-0">
        <Text className="min-w-0 truncate text-base font-semibold tracking-tight">
          {conversation.subject || conversation.title}
        </Text>
        <Row gap={2} className="shrink-0 items-center">
          <ConversationAssigneePicker
            conversation={conversation}
            organizationId={organizationId}
          />
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label={t('header.moreActions')}
              >
                <Ellipsis className="text-muted-foreground size-5" />
              </Button>
            }
            items={[moreMenuItems]}
            align="end"
            onOpenChange={handleDropdownOpenChange}
          />
        </Row>
      </Row>

      {/* Sender Row */}
      <div className="flex min-w-0 items-center gap-2.5">
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
            className="cursor-pointer truncate text-left text-[13px] font-semibold tracking-tight hover:underline"
            onClick={() => setIsContactInfoOpen(true)}
          >
            {primaryLabel}
          </button>
          <div className="text-muted-foreground flex min-w-0 items-center text-xs tracking-tight">
            {showEmailInMeta && (
              <button
                type="button"
                className="hidden min-w-0 cursor-pointer truncate hover:underline md:inline"
                onClick={() => setIsContactInfoOpen(true)}
              >
                {contact.email}
              </button>
            )}
            {lastMessageTime && (
              <>
                {showEmailInMeta && (
                  <DotIcon className="mx-0.5 hidden shrink-0 md:inline-flex" />
                )}
                <span className="shrink-0 whitespace-nowrap">
                  {lastMessageTime}
                </span>
              </>
            )}
            {conversationFrom && (
              <>
                {lastMessageTime ? (
                  <DotIcon className="mx-0.5 shrink-0" />
                ) : showEmailInMeta ? (
                  <DotIcon className="mx-0.5 hidden shrink-0 md:inline-flex" />
                ) : null}
                <Tooltip content={inboxLabel ?? conversationFrom}>
                  <span
                    className="inline-flex min-w-0 items-center gap-1"
                    aria-label={t('header.inboxSource', {
                      inbox: conversationFrom,
                    })}
                  >
                    <Mail className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{conversationFrom}</span>
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>
    </Stack>
  );
}
