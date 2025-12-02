'use client';

import { CardContent } from '@/components/ui/card';
import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Message from './message';
import ConversationHeader from './conversation-header';
import { Loader2Icon, MessageSquareMoreIcon } from 'lucide-react';
import { useQuery as useConvexQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { toast } from '@/hooks/use-toast';
import { useThrottledScroll } from '@/hooks/use-throttled-scroll';
import { cn } from '@/lib/utils/cn';

const MessageEditor = dynamic(() => import('./message-editor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center p-4">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

import {
  groupMessagesByDate,
  formatDateHeader,
} from '@/lib/utils/conversation/date-utils';

interface AttachedFile {
  id: string;
  file: File | null;
  type: 'image' | 'video' | 'audio' | 'document';
}

interface UploadedAttachment {
  storageId: string;
  name: string;
  size: number;
  type: string;
  contentType: string;
}

interface ConversationPanelProps {
  selectedConversationId: string | null;
  onSelectedConversationChange: (conversationId: string | null) => void;
}

export default function ConversationPanel({
  selectedConversationId,
  onSelectedConversationChange,
}: ConversationPanelProps) {
  // Use Convex query hook
  const conversation = useConvexQuery(
    api.conversations.getConversationWithMessages,
    selectedConversationId
      ? { conversationId: selectedConversationId as Id<'conversations'> }
      : 'skip',
  );

  // Convex mutations
  const markAsRead = useMutation(api.conversations.markConversationAsRead);
  const sendMessageViaEmail = useMutation(
    api.conversations.sendMessageViaEmail,
  );
  const generateUploadUrl = useMutation(api.file.generateUploadUrl);

  const isLoading = conversation === undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const messageComposerRef = useRef<HTMLDivElement>(null);

  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });

  // Get stable reference to messages count
  const messagesCount = conversation?.messages?.length ?? 0;

  // Smooth auto-scroll when messages change
  useEffect(() => {
    if (!selectedConversationId || isLoading) return;

    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'auto');
    }
  }, [
    selectedConversationId,
    messagesCount,
    isLoading,
    throttledScrollToBottom,
  ]);

  // Cleanup throttled scroll on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Mark conversation as read when it's opened and has unread messages
  useEffect(() => {
    if (conversation && selectedConversationId) {
      // Only mark as read if there are unread messages
      // (last_message_at is after last_read_at, or last_read_at doesn't exist)
      const hasUnreadMessages =
        conversation.last_message_at &&
        (!conversation.last_read_at ||
          new Date(conversation.last_message_at) >
            new Date(conversation.last_read_at));

      if (hasUnreadMessages) {
        markAsRead({
          conversationId: selectedConversationId as Id<'conversations'>,
        }).catch((error: Error) => {
          console.error('Failed to mark conversation as read:', error);
        });
      }
    }
  }, [conversation, selectedConversationId, markAsRead]);

  const handleSaveMessage = async (
    message: string,
    attachments?: AttachedFile[],
  ) => {
    console.log('handleSaveMessage called with message:', message);
    console.log('Attachments:', attachments);

    if (!conversation) {
      console.log('No conversation found');
      return;
    }

    // Handle file uploads to Convex storage if there are attachments
    let uploadedAttachments: UploadedAttachment[] | undefined;

    if (attachments && attachments.length > 0) {
      try {
        uploadedAttachments = await Promise.all(
          attachments.map(async (attachment) => {
            if (!attachment.file) {
              throw new Error('Invalid file attachment');
            }

            // Generate upload URL from Convex
            const uploadUrl = await generateUploadUrl();

            // Upload file to Convex storage
            const response = await fetch(uploadUrl, {
              method: 'POST',
              headers: { 'Content-Type': attachment.file.type },
              body: attachment.file,
            });

            const { storageId } = await response.json();

            return {
              storageId,
              name: attachment.file.name,
              size: attachment.file.size,
              type: attachment.type,
              contentType: attachment.file.type,
            };
          }),
        );

        console.log('Files uploaded successfully:', uploadedAttachments);
      } catch (error) {
        console.error('Error uploading attachments:', error);
        toast({
          title: 'Failed to upload attachments. Please try again.',
          variant: 'destructive',
        });
        return;
      }
    }

    // Extract email information from conversation metadata
    const metadata = conversation.metadata as
      | Record<string, unknown>
      | undefined;

    // For inbound conversations, metadata.from contains the customer's email
    // We need to reply TO the customer (metadata.from)
    // The sender email will be determined by the email provider in the backend
    let customerEmail = '';
    if (metadata?.from) {
      if (typeof metadata.from === 'string') {
        customerEmail = metadata.from;
      } else if (Array.isArray(metadata.from) && metadata.from.length > 0) {
        const fromObj = metadata.from[0] as { address?: string; name?: string };
        customerEmail = fromObj.address || '';
      }
    }

    const subject = conversation.subject || 'Re: Conversation';

    // For email threading, use the conversation's external message ID
    const inReplyTo = conversation.externalMessageId;
    const references = inReplyTo ? [inReplyTo] : undefined;

    if (!customerEmail) {
      console.error('No customer email found in conversation metadata');
      throw new Error('Cannot send email: customer email not found');
    }

    console.log('Sending message via sendMessageViaEmail mutation', {
      conversationId: conversation._id,
      to: [customerEmail],
      subject: `Re: ${subject}`,
      attachments: uploadedAttachments,
    });

    // Send message with attachments (backend handles channel-specific routing)
    // The backend will determine the sender email from the email provider
    await sendMessageViaEmail({
      conversationId: conversation._id,
      organizationId: conversation.organizationId,
      content: message,
      to: [customerEmail],
      subject: `Re: ${subject}`,
      html: message, // Already sanitized HTML from editor
      text: message.replace(/<[^>]*>/g, ''), // Strip HTML for plain text version
      inReplyTo,
      references,
      attachments: uploadedAttachments, // Pass attachments to backend
    });

    console.log('Message sent successfully with attachments');
    // Convex will automatically update the conversation reactively
  };

  if (!selectedConversationId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 w-[316px]">
          <MessageSquareMoreIcon className="size-5 text-muted-foreground" />
          <div className="flex flex-col gap-3 h-14 items-center justify-start text-center w-full">
            <h2 className="font-semibold text-lg text-foreground tracking-[-0.12px]">
              No conversation selected
            </h2>
            <p className="font-normal text-sm text-muted-foreground tracking-[-0.084px] leading-[20px]">
              Select a conversation to view details
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2Icon className="size-10 animate-spin" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p>Conversation not found</p>
      </div>
    );
  }

  const { messages } = conversation;

  // Filter out pending messages from display
  const displayMessages = messages.filter((msg) => msg.status !== 'pending');

  // Create pending message from approval if it exists (emailBody only)
  const pendingMessage =
    conversation.pendingApproval?.metadata &&
    typeof conversation.pendingApproval.metadata === 'object' &&
    'emailBody' in conversation.pendingApproval.metadata
      ? {
          id: conversation.pendingApproval._id,
          content: (
            conversation.pendingApproval.metadata as { emailBody: string }
          ).emailBody,
          status: 'pending' as const,
        }
      : undefined;

  const messageGroups = groupMessagesByDate(displayMessages);

  return (
    <CardContent
      ref={containerRef}
      className="flex-[1_1_0] p-0 relative scrollbar-hide flex flex-col overflow-y-auto"
    >
      <div className="flex items-center flex-[0_0_auto] bg-background/50 backdrop-blur-sm h-16 sticky top-0 z-50 border-b border-border shadow-sm">
        <ConversationHeader
          conversation={conversation}
          onResolve={() => {
            onSelectedConversationChange(null);
          }}
          onReopen={() => {
            onSelectedConversationChange(null);
          }}
        />
      </div>
      <div className="pt-2 mx-auto max-w-3xl flex-1 w-full">
        {messageGroups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">No messages yet</p>
          </div>
        ) : (
          messageGroups.map((group) => (
            <div key={group.date} className="relative">
              {/* Sticky Date Header */}
              <div className="sticky top-16 py-2 mb-4 z-10">
                <div className="flex justify-center">
                  <div className="bg-background px-2 py-0.5 rounded-full shadow-sm border border-border">
                    <span className="text-xs font-medium text-primary">
                      {formatDateHeader(group.date)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Messages for this date */}
              <div className="space-y-4 mb-8">
                {group.messages.map((message) => (
                  <Message key={message.id} message={message} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="sticky bottom-0 z-50 bg-background">
        {conversation.status === 'open' ? (
          <div ref={messageComposerRef} className="max-w-3xl mx-auto w-full">
            <MessageEditor
              key={conversation.id}
              onSave={handleSaveMessage}
              placeholder="Type a message"
              messageId={conversation.id}
              businessId={conversation.business_id}
              conversationId={conversation.id}
              onConversationResolved={() => {
                // Convex will automatically update the conversation reactively
                // Just call the parent callback to update the conversation list
                onSelectedConversationChange(null);
              }}
              pendingMessage={pendingMessage}
              hasMessageHistory={displayMessages.length > 0}
            />
          </div>
        ) : (
          <div className="px-8 py-10">
            <p className="text-center text-sm text-muted-foreground">
              {conversation.status === 'spam'
                ? 'This conversation has been marked as spam.'
                : 'This conversation has been marked as closed.'}
            </p>
          </div>
        )}
      </div>
    </CardContent>
  );
}
