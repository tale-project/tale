'use client';

import { Loader2Icon, MessageSquareMoreIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { Stack, VStack, Center } from '@/app/components/ui/layout/layout';
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
      <div className="flex items-center justify-center p-4">
        <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
      </div>
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
        <VStack gap={6} align="center" className="w-full max-w-[316px]">
          <MessageSquareMoreIcon className="text-muted-foreground size-5" />
          <VStack gap={3} align="center" className="h-14 w-full text-center">
            <h2 className="text-foreground text-lg font-semibold tracking-[-0.12px]">
              {tConversations('panel.noSelected')}
            </h2>
            <p className="text-muted-foreground text-sm leading-[20px] font-normal tracking-[-0.084px]">
              {tConversations('panel.selectToView')}
            </p>
          </VStack>
        </VStack>
      </Center>
    );
  }

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className="relative flex flex-[1_1_0] flex-col overflow-y-auto"
      >
        {/* Skeleton Header */}
        <div className="bg-background/50 border-border sticky top-0 z-50 flex h-16 flex-[0_0_auto] border-b px-4 py-3 backdrop-blur-sm">
          <div className="flex flex-1 items-center gap-3">
            <div className="bg-muted size-10 animate-pulse rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="bg-muted h-4 w-40 animate-pulse rounded" />
              <div className="bg-muted h-3 w-24 animate-pulse rounded" />
            </div>
          </div>
        </div>

        {/* Skeleton Messages */}
        <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6">
          <Stack gap={4} className="mb-8">
            {/* Left-aligned message */}
            <div className="flex flex-col">
              <div className="flex justify-start">
                <div className="relative">
                  <div className="max-w-[40rem] overflow-hidden rounded-2xl bg-white">
                    <div className="bg-muted h-24 w-96 animate-pulse" />
                  </div>
                  <div className="bg-muted/60 mt-1 h-3 w-20 animate-pulse rounded" />
                </div>
              </div>
            </div>

            {/* Right-aligned message */}
            <div className="flex flex-col">
              <div className="flex justify-end">
                <div className="relative mb-6">
                  <div className="bg-muted max-w-[40rem] overflow-hidden rounded-2xl shadow-sm">
                    <div className="bg-muted/80 h-20 w-80 animate-pulse" />
                  </div>
                </div>
              </div>
            </div>

            {/* Left-aligned message */}
            <div className="flex flex-col">
              <div className="flex justify-start">
                <div className="relative">
                  <div className="max-w-[40rem] overflow-hidden rounded-2xl bg-white">
                    <div className="bg-muted h-16 w-72 animate-pulse" />
                  </div>
                  <div className="bg-muted/60 mt-1 h-3 w-20 animate-pulse rounded" />
                </div>
              </div>
            </div>
          </Stack>
        </div>

        {/* Skeleton Message Editor */}
        <div className="bg-background sticky bottom-0 z-50 px-2">
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
            <div className="bg-muted/40 border-border h-32 w-full animate-pulse rounded-lg border" />
          </div>
        </div>
      </div>
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
          content:
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex metadata uses v.any()
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
      <div className="bg-background/50 border-border sticky top-0 z-50 flex h-16 flex-[0_0_auto] border-b px-4 py-3 backdrop-blur-sm">
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
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-2">
        {messageGroups.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <p className="text-sm">{tConversations('panel.noMessages')}</p>
          </div>
        ) : (
          messageGroups.map((group) => (
            <div key={group.date} className="relative">
              {/* Sticky Date Header */}
              <div className="sticky top-16 z-10 mb-4 py-2">
                <div className="flex justify-center">
                  <div className="bg-background border-border rounded-full border px-2 py-0.5 shadow-sm">
                    <span className="text-primary text-xs font-medium">
                      {formatDateHeader(group.date)}
                    </span>
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
      <div className="bg-background sticky bottom-0 z-50 px-2">
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
            <p className="text-muted-foreground text-center text-sm">
              {conversation.status === 'spam'
                ? tConversations('panel.markedAsSpam')
                : tConversations('panel.markedAsClosed')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
