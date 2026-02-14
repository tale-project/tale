'use client';

import { MoreVertical } from 'lucide-react';
import {
  ArrowLeft,
  MessageSquare,
  MessageSquareOff,
  ShieldX,
  UserIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { Stack, HStack } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { CustomerInfoDialog } from '@/app/features/customers/components/customer-info-dialog';
import {
  useCustomerById,
  useCustomers,
} from '@/app/features/customers/hooks/queries';
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

  return (
    <>
      <HStack gap={4} justify="between" className="mx-4 w-full min-w-0">
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
        <Stack className="min-w-0 space-y-1 overflow-hidden">
          {/* Title */}
          <h2 className="text-foreground flex items-center gap-2 text-base font-medium tracking-tight whitespace-nowrap [&>*]:leading-none">
            {customer.name && (
              <>
                <button
                  className="cursor-pointer hover:underline"
                  onClick={() => setIsCustomerInfoOpen(true)}
                >
                  {customer.name}
                </button>
                <DotIcon className="flex-shrink-0" />
              </>
            )}
            <span title={conversation.title} className="max-w-xl truncate">
              {conversation.title}
            </span>
          </h2>

          {/* Metadata */}
          <HStack
            gap={1}
            className="text-muted-foreground text-sm font-normal tracking-tight whitespace-nowrap"
          >
            <button
              className="cursor-pointer hover:underline"
              onClick={() => setIsCustomerInfoOpen(true)}
            >
              {customer.email}
            </button>
            {customer.locale && (
              <>
                <DotIcon className="flex-shrink-0" />
                <span>{customer.locale}</span>
              </>
            )}
          </HStack>
        </Stack>

        {/* Options Menu */}
        <div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={tCommon('aria.actionsMenu')}
              >
                <MoreVertical className="text-muted-foreground size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border w-[14rem] rounded-xl border p-2 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
            >
              <DropdownMenuItem
                onClick={() => setIsCustomerInfoOpen(true)}
                disabled={isLoading}
                className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-lg p-2"
              >
                <UserIcon className="text-muted-foreground size-5" />
                <span className="text-muted-foreground text-sm font-medium">
                  {t('header.customerInfo')}
                </span>
              </DropdownMenuItem>
              {conversation.status === 'open' && (
                <DropdownMenuItem
                  onClick={handleResolveConversation}
                  disabled={isLoading}
                  className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-lg p-2"
                >
                  <MessageSquareOff className="text-muted-foreground size-5" />
                  <span className="text-muted-foreground text-sm font-medium">
                    {isClosing
                      ? t('header.closing')
                      : t('header.closeConversation')}
                  </span>
                </DropdownMenuItem>
              )}
              {conversation.status !== 'open' && (
                <DropdownMenuItem
                  onClick={handleReopenConversation}
                  disabled={isLoading}
                  className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-lg p-2"
                >
                  <MessageSquare className="text-muted-foreground size-5" />
                  <span className="text-muted-foreground text-sm font-medium">
                    {isReopening
                      ? t('header.reopening')
                      : t('header.reopenConversation')}
                  </span>
                </DropdownMenuItem>
              )}
              {conversation.status === 'open' && (
                <DropdownMenuItem
                  onClick={handleMarkAsSpam}
                  disabled={isLoading}
                  className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-lg p-2"
                >
                  <ShieldX className="text-muted-foreground size-5" />
                  <span className="text-muted-foreground text-sm font-medium">
                    {isMarkingSpam
                      ? t('header.markingAsSpam')
                      : t('header.markAsSpam')}
                  </span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </HStack>

      {/* Customer Info Dialog */}
      {customerDoc && (
        <CustomerInfoDialog
          customer={customerDoc}
          open={isCustomerInfoOpen}
          onOpenChange={setIsCustomerInfoOpen}
        />
      )}
    </>
  );
}
