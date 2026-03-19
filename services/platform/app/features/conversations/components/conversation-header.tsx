'use client';

import {
  ArrowLeft,
  Ellipsis,
  MessageSquare,
  MessageSquareOff,
  ShieldX,
  UserIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  DropdownMenu,
  type DropdownMenuItem,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { CustomerInfoPopover } from '@/app/features/customers/components/customer-info-popover';
import {
  useCustomerById,
  useCustomers,
} from '@/app/features/customers/hooks/queries';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import type { ConversationWithMessages } from '../types';

import {
  useCloseConversation,
  useMarkAsSpam,
  useReopenConversation,
} from '../hooks/mutations';
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
  const { customer } = conversation;
  const [isCustomerInfoOpen, setIsCustomerInfoOpen] = useState(false);
  const pendingCustomerInfo = useRef(false);
  const { formatRelative } = useFormatDate();

  const { mutate: closeConversation, isPending: isClosing } =
    useCloseConversation();
  const { mutate: reopenConversation, isPending: isReopening } =
    useReopenConversation();
  const { mutate: markAsSpamMutation, isPending: isMarkingSpam } =
    useMarkAsSpam();
  const isLoading = isClosing || isReopening || isMarkingSpam;

  const { customers } = useCustomers(organizationId);
  const customerDoc = useCustomerById(customers, conversation.customerId);

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

  const customerData = customerDoc ?? conversation.customer;

  const moreMenuItems = useMemo<DropdownMenuItem[]>(() => {
    const items: DropdownMenuItem[] = [
      {
        type: 'item',
        label: t('header.customerInfo'),
        icon: UserIcon,
        onClick: () => {
          pendingCustomerInfo.current = true;
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
    if (!open && pendingCustomerInfo.current) {
      pendingCustomerInfo.current = false;
      setTimeout(() => setIsCustomerInfoOpen(true), 0);
    }
  }, []);

  const initial = (customer.name ?? customer.email ?? '?')
    .charAt(0)
    .toUpperCase();

  const lastMessageTime = conversation.last_message_at
    ? formatRelative(new Date(conversation.last_message_at))
    : null;

  return (
    <div className="border-border flex flex-col gap-3 border-b px-6 py-4">
      {/* Back button - visible only on mobile */}
      {onBack && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={onBack}
          aria-label={tCommon('actions.back')}
        >
          <ArrowLeft className="size-5" />
        </Button>
      )}

      {/* Subject Row */}
      <div className="flex items-center justify-between gap-4">
        <Text className="min-w-0 truncate text-base font-semibold tracking-tight">
          {conversation.subject || conversation.title}
        </Text>
        <div className="flex shrink-0 items-center gap-1">
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
        </div>
      </div>

      {/* Sender Row */}
      <div className="flex items-center gap-2.5">
        <CustomerInfoPopover
          customer={customerData}
          open={isCustomerInfoOpen}
          onOpenChange={setIsCustomerInfoOpen}
          trigger={
            <button
              type="button"
              className="bg-muted flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full"
              aria-label={t('header.customerInfo')}
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
            onClick={() => setIsCustomerInfoOpen(true)}
          >
            {customer.name || customer.email}
          </button>
          <div className="text-muted-foreground flex items-center text-xs tracking-tight">
            <button
              type="button"
              className="cursor-pointer hover:underline"
              onClick={() => setIsCustomerInfoOpen(true)}
            >
              {customer.email}
            </button>
            {lastMessageTime && (
              <>
                <DotIcon className="mx-0.5 shrink-0" />
                <span>{lastMessageTime}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
