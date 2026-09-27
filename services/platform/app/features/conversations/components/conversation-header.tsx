'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuItem } from '@tale/ui/dropdown-menu';
import { SkeletonBox, SkeletonCircle, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { ThreadHeader, ThreadHeaderSeparator } from '@tale/ui/thread-header';
import { Tooltip } from '@tale/ui/tooltip';
import { useCopy } from '@tale/ui/use-copy';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import {
  Ellipsis,
  Link2,
  Mail,
  MessageSquare,
  MessageSquareOff,
  Plug,
  ShieldX,
  UserIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { ContactInfoPopover } from '@/app/features/contacts/components/contact-info-popover';
import {
  useContactById,
  useContacts,
} from '@/app/features/contacts/hooks/queries';
import { useT } from '@/lib/i18n/client';
import {
  mailboxSideAddress,
  resolveReplyFrom,
} from '@/lib/shared/conversations/reply-from';
import { isRecord } from '@/lib/utils/type-utils';

import {
  useCloseConversation,
  useMarkAsSpam,
  useReopenConversation,
} from '../hooks/mutations';
import { useMailboxes } from '../hooks/queries';
import { channelSourceOf } from '../lib/channel-source';
import type { ConversationWithMessages } from '../types';
import { ContactInitials } from './contact-initials';
import { ConversationAssigneePicker } from './conversation-assignee-picker';

/**
 * The header while its conversation is on the way: the live header's own
 * ThreadHeader row — the contact's avatar, the subject, the context line and
 * the verbs — with each value masked, so the thread below doesn't jump when
 * the conversation arrives. Render it inside the panel's `<Skeletonize
 * loading>`; `before` (the way back) stays live, since leaving never waits.
 */
export function ConversationHeaderSkeleton({ before }: { before?: ReactNode }) {
  return (
    <ThreadHeader
      className="sm:px-6"
      before={
        before === undefined ? undefined : (
          <Skeletonize loading={false} className="contents">
            {before}
          </Skeletonize>
        )
      }
      leading={
        <SkeletonCircle asChild>
          <div className="size-8 shrink-0 rounded-full" />
        </SkeletonCircle>
      }
      title={
        <span className="block w-64 max-w-full">
          <SkeletonText />
        </span>
      }
      meta={
        <span className="block w-44 max-w-full">
          <SkeletonText seed={1} />
        </span>
      }
      actions={
        <>
          <SkeletonBox asChild>
            <div className="size-8 rounded-lg" />
          </SkeletonBox>
          <SkeletonBox asChild>
            <div className="size-8 rounded-lg @xl/thread-header:w-20" />
          </SkeletonBox>
          <SkeletonBox asChild>
            <div className="size-8 rounded-lg" />
          </SkeletonBox>
        </>
      }
    />
  );
}

interface ConversationHeaderProps {
  conversation: ConversationWithMessages;
  organizationId: string;
  /** Controls before the identity — a phone's way back to Home. */
  before?: ReactNode;
  onResolve?: () => void;
  onReopen?: () => void;
}

export function ConversationHeader({
  conversation,
  organizationId,
  before,
  onResolve,
  onReopen,
}: ConversationHeaderProps) {
  const { t } = useT('conversations');
  const { contact } = conversation;
  const [isContactInfoOpen, setIsContactInfoOpen] = useState(false);
  const pendingContactInfo = useRef(false);
  const { formatRelative } = useFormatDate();

  // Which of the org's mailboxes THIS thread belongs to: the one the server
  // placed it on (`credentialId`), never a lookup by connector — one connector
  // can hold several mailboxes, and naming the connector's last one put a
  // mailbox's name beside another mailbox's address. A thread the server
  // could not place shows its address alone.
  //
  // The address is read from the side of the envelope that is ours
  // (`mailboxSideAddress`: the recipient on inbound mail, the sender on
  // sent-folder mail we synced back, where `metadata.to` is the contact).
  // Reading `to` blindly is what made an unconnected personal address look
  // like the inbox source on outbound threads. With a configured From
  // (imap_smtp mirrors the login) `resolveReplyFrom` keeps the mailbox address
  // unless the thread ran on a genuine same-domain alias; gmail/outlook expose
  // no From, so the envelope's own address stands on its own.
  //
  // The lane also covers a thread that has no envelope address to show. An
  // API thread carries no `metadata.to`, so before that it showed nothing.
  const { mailboxes } = useMailboxes();
  const source = channelSourceOf(conversation, mailboxes);
  const mailbox = source.mailbox;
  const ourAddress = mailboxSideAddress(
    isRecord(conversation.metadata) ? conversation.metadata : undefined,
    conversation.direction,
  );
  const conversationFrom = mailbox?.fromAddress
    ? resolveReplyFrom(ourAddress, mailbox.fromAddress)
    : ourAddress;
  const inboxLabel = mailbox?.name;

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

  // The conversation's own address, as a teammate would open it: this page
  // with the conversation selected, nothing else from the query.
  const { copy } = useCopy();
  const copyLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?conversation=${encodeURIComponent(conversation.id)}`;
    void copy(link).then((copied) => {
      if (copied) toast({ title: t('header.linkCopied') });
    });
  };

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

  const lastMessageTime = conversation.last_message_at
    ? formatRelative(new Date(conversation.last_message_at))
    : null;

  // Primary line prefers a display name; when the contact has none, it already
  // shows the email — repeating it on the meta line is noise and eats width.
  const primaryLabel = contact.name || contact.email || t('unknownContact');
  const showEmailInMeta = Boolean(contact.name && contact.email);

  // Where the thread came in, and so where a reply goes back out. The
  // connector's name is shown, not hidden in a tooltip: with two connectors
  // installed the address alone does not say which one carries the thread.
  // An API thread has no address, so its source slug stands in its place.
  const sourceLabel =
    source.lane === 'api'
      ? t('header.apiSource', {
          source: source.label ?? t('header.apiSourceShort'),
        })
      : conversationFrom
        ? inboxLabel
          ? `${inboxLabel} · ${conversationFrom}`
          : conversationFrom
        : null;

  return (
    <ThreadHeader
      className="sm:px-6"
      before={before}
      leading={
        <ContactInfoPopover
          contact={contactData}
          open={isContactInfoOpen}
          onOpenChange={setIsContactInfoOpen}
          trigger={
            <button
              type="button"
              className="focus-visible:ring-ring cursor-pointer rounded-full focus-visible:ring-2 focus-visible:outline-none"
              aria-label={t('header.contactInfo')}
            >
              <ContactInitials label={primaryLabel} size="lg" />
            </button>
          }
        />
      }
      title={
        <h2 className="truncate">
          {conversation.subject || conversation.title}
        </h2>
      }
      meta={
        // The context line holds its items in the order they matter: who,
        // when, their address, the inbox a reply goes out through. Each
        // keeps its whole width, and one that no longer fits wraps onto a
        // second line this row clips away — so a narrow header (a phone, or
        // a tablet's column beside the rail and the panel) drops the least
        // important items instead of cutting every one down to a letter.
        // Only the name, always first, truncates, and only when it alone
        // overflows. The padding keeps the name's focus ring inside the clip;
        // each separator travels with the item it introduces.
        <span className="-m-1 flex h-6 min-w-0 flex-1 flex-wrap content-start items-center gap-x-1.5 gap-y-2 overflow-hidden p-1">
          <button
            type="button"
            className="text-foreground/80 focus-visible:ring-ring min-w-0 cursor-pointer truncate rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => setIsContactInfoOpen(true)}
          >
            {primaryLabel}
          </button>
          {lastMessageTime && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <ThreadHeaderSeparator />
              {lastMessageTime}
            </span>
          )}
          {showEmailInMeta && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <ThreadHeaderSeparator />
              {contact.email}
            </span>
          )}
          {sourceLabel !== null && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <ThreadHeaderSeparator />
              <Tooltip content={sourceLabel}>
                <span
                  className="inline-flex items-center gap-1"
                  aria-label={
                    source.lane === 'api'
                      ? sourceLabel
                      : t('header.inboxSource', { inbox: conversationFrom })
                  }
                >
                  {source.lane === 'api' ? (
                    <Plug className="size-3 shrink-0" aria-hidden="true" />
                  ) : (
                    <Mail className="size-3 shrink-0" aria-hidden="true" />
                  )}
                  {sourceLabel}
                </span>
              </Tooltip>
            </span>
          )}
        </span>
      }
      actions={
        <>
          <Tooltip content={t('header.copyLink')} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={copyLink}
              aria-label={t('header.copyLink')}
              className="text-muted-foreground hover:text-foreground size-8 shrink-0"
            >
              <Link2 className="size-4" />
            </Button>
          </Tooltip>
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
        </>
      }
    />
  );
}
