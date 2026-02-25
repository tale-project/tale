'use client';

import { Loader2Icon, MessageSquareMoreIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { PanelHeader } from '@/app/components/layout/panel-header';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import {
  Center,
  HStack,
  Stack,
  VStack,
} from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';

import {
  useDownloadAttachments,
  useGenerateUploadUrl,
  useMarkAsRead,
  useSendMessageViaIntegration,
} from '../hooks/mutations';
import { useConversationWithMessages } from '../hooks/queries';
import { ConversationHeader } from './conversation-header';
import { Message } from './message';

const MessageEditor = lazyComponent(
  () =>
    import('./message-editor').then((mod) => ({ default: mod.MessageEditor })),
  {
    loading: () => (
      <Center className="p-4">
        <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
      </Center>
    ),
  },
);

import { useFormatDate } from '@/app/hooks/use-format-date';
import { groupMessagesByDate } from '@/lib/utils/conversation/date-utils';

interface AttachedFile {
  id: string;
  file: File | null;
  type: 'image' | 'video' | 'audio' | 'document';
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
  const { formatDateHeader } = useFormatDate();

  const { data: conversation, isLoading } = useConversationWithMessages(
    selectedConversationId,
  );

  const { mutate: markAsRead } = useMarkAsRead();
  const { mutateAsync: sendMessageViaIntegration } =
    useSendMessageViaIntegration();
  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl();
  const { mutate: downloadAttachments } = useDownloadAttachments();

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
        markAsRead(
          { conversationId: toId<'conversations'>(selectedConversationId) },
          {
            onError: (error) => {
              console.error('Failed to mark conversation as read:', error);
            },
          },
        );
      }
    }
  }, [conversation, selectedConversationId, markAsRead]);

  const handleSaveMessage = async (
    message: string,
    attachments?: AttachedFile[],
  ) => {
    if (!conversation) {
      return;
    }

    let uploadedAttachments:
      | Array<{
          storageId: Id<'_storage'>;
          fileName: string;
          contentType: string;
          size: number;
        }>
      | undefined;

    if (attachments && attachments.length > 0) {
      try {
        const validAttachments = attachments.filter((a) => a.file);
        if (validAttachments.length !== attachments.length) {
          throw new Error(tConversations('panel.invalidFileAttachment'));
        }

        uploadedAttachments = await Promise.all(
          validAttachments.map(async (attachment) => {
            const file = attachment.file;
            if (!file)
              throw new Error(tConversations('panel.invalidFileAttachment'));

            const uploadUrl = await generateUploadUrl({});

            const result = await fetch(uploadUrl, {
              method: 'POST',
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
              },
              body: file,
            });

            if (!result.ok) {
              throw new Error(tConversations('panel.uploadFailed'));
            }

            const { storageId: rawStorageId } = await result.json();

            if (typeof rawStorageId !== 'string') {
              throw new Error(tConversations('panel.uploadFailed'));
            }

            return {
              storageId: toId<'_storage'>(rawStorageId),
              fileName: file.name,
              contentType: file.type,
              size: file.size,
            };
          }),
        );
      } catch (error) {
        console.error('Error uploading attachments:', error);
        toast({
          title: tConversations('panel.uploadFailed'),
          variant: 'destructive',
        });
        return;
      }
    }

    const customerEmail = conversation.customer.email;

    if (!customerEmail || customerEmail === 'unknown@example.com') {
      console.error('No customer email found in conversation');
      throw new Error(tConversations('panel.customerEmailNotFound'));
    }

    const subject =
      conversation.subject || tConversations('panel.defaultSubject');

    const replySubject = tConversations('panel.replySubjectPrefix', {
      subject,
    });

    await sendMessageViaIntegration({
      conversationId: toId<'conversations'>(conversation._id),
      organizationId: conversation.organizationId,
      integrationName: conversation.integrationName ?? 'outlook',
      content: message,
      to: [customerEmail],
      subject: replySubject,
      html: message,
      text: message.replace(/<[^>]*>/g, ''),
      ...(uploadedAttachments?.length
        ? { attachments: uploadedAttachments }
        : {}),
    });
  };

  if (!selectedConversationId) {
    return (
      <Center className="flex-1 px-4">
        <EmptyState
          icon={MessageSquareMoreIcon}
          title={tConversations('panel.noSelected')}
          description={tConversations('panel.selectToView')}
        />
      </Center>
    );
  }

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className="relative flex flex-[1_1_0] flex-col overflow-y-auto"
      >
        <PanelHeader>
          <HStack gap={3} className="flex-1">
            <Skeleton className="size-10 rounded-full" />
            <VStack className="flex-1 gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </VStack>
          </HStack>
        </PanelHeader>

        <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6">
          <Stack gap={4} className="mb-8">
            <div className="flex justify-start">
              <div className="relative">
                <Skeleton className="h-24 w-96 rounded-2xl" />
                <Skeleton className="mt-1 h-3 w-20" />
              </div>
            </div>

            <div className="flex justify-end">
              <div className="relative mb-6">
                <Skeleton className="h-20 w-80 rounded-2xl" />
              </div>
            </div>

            <div className="flex justify-start">
              <div className="relative">
                <Skeleton className="h-16 w-72 rounded-2xl" />
                <Skeleton className="mt-1 h-3 w-20" />
              </div>
            </div>
          </Stack>
        </div>

        <PanelFooter className="px-2">
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        </PanelFooter>
      </div>
    );
  }

  if (!conversation) {
    return (
      <Center className="flex-1">
        <Text>{tConversations('panel.notFound')}</Text>
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
          content:
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata shape verified by 'emailBody' in check above
            (conversation.pendingApproval.metadata as { emailBody: string })
              .emailBody,
        }
      : undefined;

  const messageGroups = groupMessagesByDate(displayMessages);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-[1_1_0] flex-col overflow-y-auto"
    >
      <PanelHeader>
        <ConversationHeader
          conversation={conversation}
          organizationId={conversation.organizationId}
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
      </PanelHeader>
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-2">
        {messageGroups.length === 0 ? (
          <Center className="h-full">
            <Text variant="muted">{tConversations('panel.noMessages')}</Text>
          </Center>
        ) : (
          messageGroups.map((group) => (
            <div key={group.date} className="relative">
              {/* Sticky Date Header */}
              <div className="sticky top-16 z-10 mb-4 py-2">
                <div className="flex justify-center">
                  <div className="bg-background border-border rounded-full border px-2 py-0.5 shadow-sm">
                    <Text as="span" variant="label-sm" className="text-primary">
                      {formatDateHeader(group.date)}
                    </Text>
                  </div>
                </div>
              </div>

              {/* Messages for this date */}
              <Stack gap={4} className="mb-8">
                {group.messages.map((message) => (
                  <Message
                    key={message.id}
                    message={message}
                    onDownloadAttachments={(messageId) => {
                      downloadAttachments(
                        {
                          messageId: toId<'conversationMessages'>(messageId),
                        },
                        {
                          onError: (error) => {
                            console.error(
                              'Failed to download attachments:',
                              error,
                            );
                            toast({
                              title: tConversations('panel.downloadFailed'),
                              variant: 'destructive',
                            });
                          },
                        },
                      );
                    }}
                  />
                ))}
              </Stack>
            </div>
          ))
        )}
      </div>
      <PanelFooter className="px-2">
        {conversation.status === 'open' ? (
          <div ref={messageComposerRef} className="mx-auto w-full max-w-3xl">
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
            <Text variant="muted" align="center">
              {conversation.status === 'spam'
                ? tConversations('panel.markedAsSpam')
                : tConversations('panel.markedAsClosed')}
            </Text>
          </div>
        )}
      </PanelFooter>
    </div>
  );
}
