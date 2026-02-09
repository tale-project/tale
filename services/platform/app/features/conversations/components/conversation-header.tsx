'use client';

import { useQuery } from 'convex/react';
import { MoreVertical } from 'lucide-react';
import {
  ArrowLeft,
  MessageSquare,
  MessageSquareOff,
  ShieldX,
  UserIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Stack, HStack } from '@/app/components/ui/layout/layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { CustomerInfoDialog } from '@/app/features/customers/components/customer-info-dialog';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import type { ConversationWithMessages } from '../types';

import { useCloseConversation } from '../hooks/use-close-conversation';
import { useMarkAsSpam } from '../hooks/use-mark-as-spam';
import { useReopenConversation } from '../hooks/use-reopen-conversation';
import { DotIcon } from './dot-icon';

interface ConversationHeaderProps {
  conversation: ConversationWithMessages;
  onResolve?: () => void;
  onReopen?: () => void;
  onBack?: () => void;
}

export function ConversationHeader({
  conversation,
  onResolve,
  onReopen,
  onBack,
}: ConversationHeaderProps) {
  const { t } = useT('conversations');
  const { t: tCommon } = useT('common');
  const { customer } = conversation;
  const [isCustomerInfoOpen, setIsCustomerInfoOpen] = useState(false);
  const [isResolvingLoading, setIsResolvingLoading] = useState(false);
  const [isReopeningLoading, setIsReopeningLoading] = useState(false);
  const [isMarkingSpamLoading, setIsMarkingSpamLoading] = useState(false);
  const isLoading =
    isResolvingLoading || isReopeningLoading || isMarkingSpamLoading;

  // Convex mutations with optimistic updates for immediate UI feedback
  const closeConversation = useCloseConversation();
  const reopenConversation = useReopenConversation();
  const markAsSpamMutation = useMarkAsSpam();

  // Fetch full customer document when dialog is open
  const customerDoc = useQuery(
    api.customers.queries.getCustomer,
    isCustomerInfoOpen && conversation.customerId
      ? // Convex validator uses v.string() for IDs — cast required for query
        { customerId: conversation.customerId as Id<'customers'> }
      : 'skip',
  );

  const handleResolveConversation = async () => {
    setIsResolvingLoading(true);
    try {
      await closeConversation({
        // Convex validator uses v.string() for IDs — cast required for mutation
        conversationId: conversation.id as Id<'conversations'>,
      });

      toast({
        title: t('header.toast.closed'),
        variant: 'success',
      });
      onResolve?.();
    } catch (error) {
      console.error('Error closing conversation:', error);
      toast({
        title: t('header.toast.closeFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsResolvingLoading(false);
    }
  };

  const handleReopenConversation = async () => {
    setIsReopeningLoading(true);
    try {
      await reopenConversation({
        // Convex validator uses v.string() for IDs — cast required for mutation
        conversationId: conversation.id as Id<'conversations'>,
      });

      toast({
        title: t('header.toast.reopened'),
        variant: 'success',
      });
      onReopen?.();
    } catch (error) {
      console.error('Error reopening conversation:', error);
      toast({
        title: t('header.toast.reopenFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsReopeningLoading(false);
    }
  };

  const handleMarkAsSpam = async () => {
    setIsMarkingSpamLoading(true);
    try {
      await markAsSpamMutation({
        // Convex validator uses v.string() for IDs — cast required for mutation
        conversationId: conversation.id as Id<'conversations'>,
      });

      toast({
        title: t('header.toast.markedAsSpam'),
        variant: 'success',
      });
      onResolve?.();
    } catch (error) {
      console.error('Error marking conversation as spam:', error);
      toast({
        title: t('header.toast.markAsSpamFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsMarkingSpamLoading(false);
    }
  };

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
                    {isResolvingLoading
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
                    {isReopeningLoading
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
                    {isMarkingSpamLoading
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
