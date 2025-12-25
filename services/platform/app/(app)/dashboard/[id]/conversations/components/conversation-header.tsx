'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical } from 'lucide-react';
import {
  ArrowLeft,
  MessageSquare,
  MessageSquareOff,
  ShieldX,
  UserIcon,
} from 'lucide-react';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import type { ConversationWithMessages } from '../types';
import DotIcon from './dot-icon';
import {
  useCloseConversation,
  useReopenConversation,
  useMarkAsSpam,
} from '../hooks';

interface ConversationHeaderProps {
  conversation: ConversationWithMessages;
  onResolve?: () => void;
  onReopen?: () => void;
  onBack?: () => void;
}

export default function ConversationHeader({
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
    api.customers.getCustomer,
    isCustomerInfoOpen && conversation.customerId
      ? { customerId: conversation.customerId as Id<'customers'> }
      : 'skip',
  );

  const handleResolveConversation = async () => {
    setIsResolvingLoading(true);
    try {
      await closeConversation({
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
      <div className="flex items-center justify-between gap-4 mx-4 w-full min-w-0">
        {/* Back button - visible only on mobile */}
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0"
            onClick={onBack}
            aria-label={tCommon('actions.back')}
          >
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <div className="flex flex-col min-w-0 overflow-hidden">
          {/* Title */}
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground tracking-tight whitespace-nowrap">
            {customer.name && (
              <>
                <button
                  className="hover:underline cursor-pointer"
                  onClick={() => setIsCustomerInfoOpen(true)}
                >
                  {customer.name}
                </button>
                <DotIcon className="flex-shrink-0" />
              </>
            )}
            <span className="truncate min-w-0">{conversation.title}</span>
          </h2>

          {/* Metadata */}
          <div className="flex items-center gap-1 text-sm font-normal text-muted-foreground tracking-tight whitespace-nowrap">
            <button
              className="hover:underline cursor-pointer"
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
          </div>
        </div>

        {/* Options Menu */}
        <div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={tCommon('aria.actionsMenu')}
              >
                <MoreVertical className="size-5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-[14rem] p-2 border border-border rounded-xl shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
            >
              <DropdownMenuItem
                onClick={() => setIsCustomerInfoOpen(true)}
                disabled={isLoading}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
              >
                <UserIcon className="size-5 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  {t('header.customerInfo')}
                </span>
              </DropdownMenuItem>
              {conversation.status === 'open' && (
                <DropdownMenuItem
                  onClick={handleResolveConversation}
                  disabled={isLoading}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
                >
                  <MessageSquareOff className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    {isResolvingLoading ? t('header.closing') : t('header.closeConversation')}
                  </span>
                </DropdownMenuItem>
              )}
              {conversation.status !== 'open' && (
                <DropdownMenuItem
                  onClick={handleReopenConversation}
                  disabled={isLoading}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
                >
                  <MessageSquare className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    {isReopeningLoading ? t('header.reopening') : t('header.reopenConversation')}
                  </span>
                </DropdownMenuItem>
              )}
              {conversation.status === 'open' && (
                <DropdownMenuItem
                  onClick={handleMarkAsSpam}
                  disabled={isLoading}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
                >
                  <ShieldX className="size-5 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    {isMarkingSpamLoading ? t('header.markingAsSpam') : t('header.markAsSpam')}
                  </span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Customer Info Modal */}
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
