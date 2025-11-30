'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical } from 'lucide-react';
import {
  MessageSquare,
  MessageSquareOff,
  ShieldX,
  UserIcon,
} from 'lucide-react';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import type { ConversationWithMessages } from '../types';
import DotIcon from './dot-icon';

interface ConversationHeaderProps {
  conversation: ConversationWithMessages;
  onResolve?: () => void;
  onReopen?: () => void;
}

export default function ConversationHeader({
  conversation,
  onResolve,
  onReopen,
}: ConversationHeaderProps) {
  const { customer } = conversation;
  const router = useRouter();
  const [isCustomerInfoOpen, setIsCustomerInfoOpen] = useState(false);
  const [isResolvingLoading, setIsResolvingLoading] = useState(false);
  const [isReopeningLoading, setIsReopeningLoading] = useState(false);
  const [isMarkingSpamLoading, setIsMarkingSpamLoading] = useState(false);
  const isLoading =
    isResolvingLoading || isReopeningLoading || isMarkingSpamLoading;

  // Convex mutations
  const resolveConversationMutation = useMutation(
    api.conversations.closeConversation,
  );
  const reopenConversationMutation = useMutation(
    api.conversations.reopenConversation,
  );
  const markAsSpamMutation = useMutation(
    api.conversations.markConversationAsSpam,
  );

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
      await resolveConversationMutation({
        conversationId: conversation.id as Id<'conversations'>,
      });

      toast({
        title: 'Conversation has been closed successfully.',
        variant: 'success',
      });
      onResolve?.();
      router.refresh();
    } catch (error) {
      console.error('Error closing conversation:', error);
      toast({
        title: 'An unexpected error occurred while closing the conversation.',
        variant: 'destructive',
      });
    } finally {
      setIsResolvingLoading(false);
    }
  };

  const handleReopenConversation = async () => {
    setIsReopeningLoading(true);
    try {
      await reopenConversationMutation({
        conversationId: conversation.id as Id<'conversations'>,
      });

      toast({
        title: 'Conversation has been reopened successfully.',
        variant: 'success',
      });
      onReopen?.();
      router.refresh();
    } catch (error) {
      console.error('Error reopening conversation:', error);
      toast({
        title: 'An unexpected error occurred while reopening the conversation.',
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
        title: 'Conversation has been marked as spam successfully.',
        variant: 'success',
      });
      onResolve?.();
      router.refresh();
    } catch (error) {
      console.error('Error marking conversation as spam:', error);
      toast({
        title:
          'An unexpected error occurred while marking the conversation as spam.',
        variant: 'destructive',
      });
    } finally {
      setIsMarkingSpamLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4 mx-4 w-full min-w-0">
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
                aria-label="Conversation actions menu"
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
                  Customer info
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
                    {isResolvingLoading ? 'Closing...' : 'Close conversation'}
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
                    {isReopeningLoading
                      ? 'Reopening...'
                      : 'Reopen conversation'}
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
                    {isMarkingSpamLoading
                      ? 'Marking as spam...'
                      : 'Mark as spam'}
                  </span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Customer Info Modal */}
      <Dialog open={isCustomerInfoOpen} onOpenChange={setIsCustomerInfoOpen}>
        {customerDoc && (
          <CustomerInfoDialog customer={customerDoc} className="rounded-2xl" />
        )}
      </Dialog>
    </>
  );
}
