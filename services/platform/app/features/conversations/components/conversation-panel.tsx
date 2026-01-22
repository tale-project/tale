'use client';

import { CardContent } from '@/app/components/ui/layout/card';
import { useEffect, useRef } from 'react';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { Message } from './message';
import { ConversationHeader } from './conversation-header';
import { Loader2Icon, MessageSquareMoreIcon } from 'lucide-react';
import { Stack, VStack, Center } from '@/app/components/ui/layout/layout';
import { useQuery as useConvexQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { useMarkAsRead } from '../hooks/use-mark-as-read';
import { useSendMessageViaEmail } from '../hooks/use-send-message-via-email';
import { useGenerateUploadUrl } from '../hooks/use-generate-upload-url';
import { toast } from '@/app/hooks/use-toast';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { useT } from '@/lib/i18n/client';

const MessageEditor = lazyComponent(
  () =>
    import('./message-editor').then((mod) => ({ default: mod.MessageEditor })),
  {
    loading: () => (
      <div className="flex items-center justify-center p-4">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

import { groupMessagesByDate } from '@/lib/utils/conversation/date-utils';
import { useDateFormat } from '@/app/hooks/use-date-format';

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

export function ConversationPanel({
  selectedConversationId,
  onSelectedConversationChange,
}: ConversationPanelProps) {
  // Translations
  const { t: tConversations } = useT('conversations');
  const { formatDateHeader } = useDateFormat();

  // Use Convex query hook
  const conversation = useConvexQuery(
    api.conversations.queries.getConversationWithMessages,
    selectedConversationId
      ? { conversationId: selectedConversationId as Id<'conversations'> }
      : 'skip',
  );

  // Convex mutations
  const markAsRead = useMarkAsRead();
  const sendMessageViaEmail = useSendMessageViaEmail();
  const generateUploadUrl = useGenerateUploadUrl();

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
        // Validate all attachments have files first
        const validAttachments = attachments.filter((a) => a.file);
        if (validAttachments.length !== attachments.length) {
          throw new Error(tConversations('panel.invalidFileAttachment'));
        }

        // Generate all upload URLs in parallel first (avoids waterfall)
        const uploadUrls = await Promise.all(
          validAttachments.map(() => generateUploadUrl()),
        );

        // Then upload all files in parallel
        uploadedAttachments = await Promise.all(
          validAttachments.map(async (attachment, index) => {
            const response = await fetch(uploadUrls[index], {
              method: 'POST',
              headers: { 'Content-Type': attachment.file!.type },
              body: attachment.file,
            });

            const { storageId } = await response.json();

            return {
              storageId,
              name: attachment.file!.name,
              size: attachment.file!.size,
              type: attachment.type,
              contentType: attachment.file!.type,
            };
          }),
        );

        console.log('Files uploaded successfully:', uploadedAttachments);
      } catch (error) {
        console.error('Error uploading attachments:', error);
        toast({
          title: tConversations('panel.uploadFailed'),
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

    const subject =
      conversation.subject || tConversations('panel.defaultSubject');

    // For email threading, use the conversation's external message ID
    const inReplyTo = conversation.externalMessageId;
    const references = inReplyTo ? [inReplyTo] : undefined;

    if (!customerEmail) {
      console.error('No customer email found in conversation metadata');
      throw new Error(tConversations('panel.customerEmailNotFound'));
    }

    const replySubject = tConversations('panel.replySubjectPrefix', {
      subject,
    });
    console.log('Sending message via sendMessageViaEmail mutation', {
      conversationId: conversation._id,
      to: [customerEmail],
      subject: replySubject,
      attachments: uploadedAttachments,
    });

    // Send message with attachments (backend handles channel-specific routing)
    // The backend will determine the sender email from the email provider
    await sendMessageViaEmail({
      conversationId: conversation._id as Id<'conversations'>,
      organizationId: conversation.organizationId,
      content: message,
      to: [customerEmail],
      subject: replySubject,
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
      <Center className="flex-1 px-4">
        <VStack gap={6} align="center" className="w-full max-w-[316px]">
          <MessageSquareMoreIcon className="size-5 text-muted-foreground" />
          <VStack gap={3} align="center" className="h-14 text-center w-full">
            <h2 className="font-semibold text-lg text-foreground tracking-[-0.12px]">
              {tConversations('panel.noSelected')}
            </h2>
            <p className="font-normal text-sm text-muted-foreground tracking-[-0.084px] leading-[20px]">
              {tConversations('panel.selectToView')}
            </p>
          </VStack>
        </VStack>
      </Center>
    );
  }

  if (isLoading) {
    return (
      <CardContent
        ref={containerRef}
        className="flex-[1_1_0] p-0 relative flex flex-col overflow-y-auto"
      >
        {/* Skeleton Header */}
        <div className="flex px-4 py-3 flex-[0_0_auto] bg-background/50 backdrop-blur-sm h-16 sticky top-0 z-50 border-b border-border shadow-sm">
          <div className="flex items-center gap-3 flex-1">
            <div className="size-10 rounded-full bg-muted animate-pulse" />
            <div className="flex flex-col gap-1.5 flex-1">
              <div className="h-4 w-40 bg-muted animate-pulse rounded" />
              <div className="h-3 w-24 bg-muted animate-pulse rounded" />
            </div>
          </div>
        </div>

        {/* Skeleton Messages */}
        <div className="pt-6 mx-auto max-w-3xl flex-1 w-full px-4">
          <Stack gap={4} className="mb-8">
            {/* Left-aligned message */}
            <div className="flex flex-col">
              <div className="flex justify-start">
                <div className="relative">
                  <div className="max-w-[40rem] bg-white rounded-2xl overflow-hidden">
                    <div className="h-24 w-96 bg-muted animate-pulse" />
                  </div>
                  <div className="h-3 w-20 bg-muted/60 animate-pulse rounded mt-1" />
                </div>
              </div>
            </div>

            {/* Right-aligned message */}
            <div className="flex flex-col">
              <div className="flex justify-end">
                <div className="relative mb-6">
                  <div className="max-w-[40rem] bg-muted rounded-2xl shadow-sm overflow-hidden">
                    <div className="h-20 w-80 bg-muted/80 animate-pulse" />
                  </div>
                </div>
              </div>
            </div>

            {/* Left-aligned message */}
            <div className="flex flex-col">
              <div className="flex justify-start">
                <div className="relative">
                  <div className="max-w-[40rem] bg-white rounded-2xl overflow-hidden">
                    <div className="h-16 w-72 bg-muted animate-pulse" />
                  </div>
                  <div className="h-3 w-20 bg-muted/60 animate-pulse rounded mt-1" />
                </div>
              </div>
            </div>
          </Stack>
        </div>

        {/* Skeleton Message Editor */}
        <div className="sticky bottom-0 z-50 bg-background px-2">
          <div className="max-w-3xl mx-auto w-full px-4 py-4">
            <div className="h-32 w-full bg-muted/40 animate-pulse rounded-lg border border-border" />
          </div>
        </div>
      </CardContent>
    );
  }

  if (!conversation) {
    return (
      <Center className="flex-1">
        <p>{tConversations('panel.notFound')}</p>
      </Center>
    );
  }

  const { messages } = conversation;

  // All messages from the database have valid delivery states, no filtering needed
  const displayMessages = messages;

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
        }
      : undefined;

  const messageGroups = groupMessagesByDate(displayMessages);

  return (
    <CardContent
      ref={containerRef}
      className="flex-[1_1_0] p-0 relative flex flex-col overflow-y-auto"
    >
      <div className="flex px-4 py-3 flex-[0_0_auto] bg-background/50 backdrop-blur-sm h-16 sticky top-0 z-50 border-b border-border shadow-sm">
        <ConversationHeader
          conversation={conversation}
          onResolve={() => {
            onSelectedConversationChange(null);
          }}
          onReopen={() => {
            onSelectedConversationChange(null);
          }}
          onBack={() => {
            onSelectedConversationChange(null);
          }}
        />
      </div>
      <div className="pt-2 mx-auto max-w-3xl flex-1 w-full px-4">
        {messageGroups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">{tConversations('panel.noMessages')}</p>
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
              <Stack gap={4} className="mb-8">
                {group.messages.map((message) => (
                  <Message key={message.id} message={message} />
                ))}
              </Stack>
            </div>
          ))
        )}
      </div>
      <div className="sticky bottom-0 z-50 bg-background px-2">
        {conversation.status === 'open' ? (
          <div ref={messageComposerRef} className="max-w-3xl mx-auto w-full">
            <MessageEditor
              key={conversation.id}
              onSave={handleSaveMessage}
              placeholder={tConversations('messagePlaceholder')}
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
                ? tConversations('panel.markedAsSpam')
                : tConversations('panel.markedAsClosed')}
            </p>
          </div>
        )}
      </div>
    </CardContent>
  );
}
