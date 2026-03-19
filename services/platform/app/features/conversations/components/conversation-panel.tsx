'use client';

import {
  AlertTriangleIcon,
  Loader2Icon,
  MessageSquareMoreIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Center, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
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
  useReopenConversation,
  useSendMessageViaIntegration,
} from '../hooks/mutations';
import { useConversationWithMessages } from '../hooks/queries';
import { ConversationHeader } from './conversation-header';
import { ConversationHeaderSkeleton } from './conversations-skeleton';
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
import { cn } from '@/lib/utils/cn';
import { groupMessagesByDate } from '@/lib/utils/conversation/date-utils';

interface AttachedFile {
  id: string;
  file: File | null;
  type: 'image' | 'video' | 'audio' | 'document';
}

interface ConversationPanelProps {
  selectedConversationId: string | null;
  onSelectedConversationChange: (conversationId: string | null) => void;
  status?: 'open' | 'closed' | 'archived' | 'spam';
}

export function ConversationPanel({
  selectedConversationId,
  onSelectedConversationChange,
  status: tabStatus,
}: ConversationPanelProps) {
  // Translations
  const { t: tConversations } = useT('conversations');
  const { formatDateHeader } = useFormatDate();

  const {
    data: conversation,
    isLoading,
    isError,
    refetch,
  } = useConversationWithMessages(selectedConversationId);

  const { mutate: markAsRead } = useMarkAsRead();
  const { mutateAsync: sendMessageViaIntegration } =
    useSendMessageViaIntegration();
  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl();
  const { mutate: downloadAttachments } = useDownloadAttachments();
  const { mutate: reopenConversation, isPending: isReopening } =
    useReopenConversation();

  const [isThreadCollapsed, setIsThreadCollapsed] = useState(true);

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

  if (isError) {
    return (
      <Center className="flex-1 flex-col gap-3 px-4">
        <AlertTriangleIcon className="text-destructive size-8" />
        <div className="space-y-1 text-center">
          <Text variant="label">{tConversations('panel.loadFailed')}</Text>
          <Text variant="muted">
            {tConversations('panel.loadFailedDescription')}
          </Text>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refetch()}
          className="mt-1"
        >
          <RefreshCwIcon className="mr-2 size-4" />
          {tConversations('panel.tryAgain')}
        </Button>
      </Center>
    );
  }

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className="relative flex flex-[1_1_0] flex-col overflow-y-auto"
      >
        <ConversationHeaderSkeleton />

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

        {tabStatus && tabStatus !== 'open' ? (
          <PanelFooter>
            <div className="border-border bg-muted/30 flex items-center justify-center gap-3 border-t px-8 py-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-8 w-36 rounded-md" />
            </div>
          </PanelFooter>
        ) : (
          <PanelFooter className="px-4 py-3">
            <div className="mx-auto w-full max-w-3xl">
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          </PanelFooter>
        )}
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

  const totalMessages = displayMessages.length;
  const COLLAPSE_THRESHOLD = 4;
  const showCollapse = totalMessages > COLLAPSE_THRESHOLD && isThreadCollapsed;
  const collapsedHiddenCount = totalMessages - 2;

  return (
    <div
      ref={containerRef}
      className="relative flex flex-[1_1_0] flex-col overflow-y-auto"
    >
      <div className="bg-background sticky top-0 z-20">
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
          <Center className="h-full">
            <Text variant="muted">{tConversations('panel.noMessages')}</Text>
          </Center>
        ) : (
          <>
            {showCollapse && (
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline"
                  onClick={() => setIsThreadCollapsed(false)}
                >
                  {tConversations('panel.showEarlierMessages', {
                    count: collapsedHiddenCount,
                  })}
                </button>
              </div>
            )}
            {messageGroups.map((group, groupIndex) => {
              const isLastGroup = groupIndex === messageGroups.length - 1;
              const messagesToShow =
                showCollapse && isLastGroup
                  ? group.messages.slice(-2)
                  : showCollapse && !isLastGroup
                    ? []
                    : group.messages;

              if (messagesToShow.length === 0) return null;

              return (
                <div key={group.date} className="relative">
                  {/* Sticky Date Header */}
                  <div className="z-10 mb-4 py-2">
                    <div className="flex justify-center">
                      <div className="bg-background border-border rounded-full border px-2 py-0.5 shadow-sm">
                        <Text
                          as="span"
                          variant="label-sm"
                          className="text-primary"
                        >
                          {formatDateHeader(group.date)}
                        </Text>
                      </div>
                    </div>
                  </div>

                  {/* Messages for this date */}
                  <Stack gap={4} className="mb-8">
                    {messagesToShow.map((message) => (
                      <Message
                        key={message.id}
                        message={message}
                        onDownloadAttachments={(messageId) => {
                          downloadAttachments(
                            {
                              messageId:
                                toId<'conversationMessages'>(messageId),
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
              );
            })}
          </>
        )}
      </div>
      <PanelFooter
        className={cn(
          'py-3 px-4',
          conversation.status !== 'open' && 'px-0 pb-0',
        )}
      >
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
                onSelectedConversationChange(null);
              }}
              pendingMessage={pendingMessage}
              hasMessageHistory={displayMessages.length > 0}
            />
          </div>
        ) : conversation.status === 'closed' ? (
          <div className="border-border bg-muted/30 flex items-center justify-center gap-3 border-t px-8 py-3">
            <Text variant="muted" className="text-sm">
              {tConversations('panel.closedBanner')}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              disabled={isReopening}
              onClick={() => {
                reopenConversation(
                  {
                    conversationId: toId<'conversations'>(conversation.id),
                  },
                  {
                    onSuccess: () => {
                      toast({
                        title: tConversations('header.toast.reopened'),
                        variant: 'success',
                      });
                      onSelectedConversationChange(null);
                    },
                    onError: (error) => {
                      console.error('Error reopening conversation:', error);
                      toast({
                        title: tConversations('header.toast.reopenFailed'),
                        variant: 'destructive',
                      });
                    },
                  },
                );
              }}
            >
              {isReopening
                ? tConversations('header.reopening')
                : tConversations('header.reopenConversation')}
            </Button>
          </div>
        ) : conversation.status === 'archived' ? (
          <div className="border-border bg-muted/30 flex items-center justify-center gap-3 border-t px-8 py-3">
            <Text variant="muted" className="text-sm">
              {tConversations('panel.archivedBanner')}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              disabled={isReopening}
              onClick={() => {
                reopenConversation(
                  {
                    conversationId: toId<'conversations'>(conversation.id),
                  },
                  {
                    onSuccess: () => {
                      toast({
                        title: tConversations('header.toast.reopened'),
                        variant: 'success',
                      });
                      onSelectedConversationChange(null);
                    },
                    onError: (error) => {
                      console.error('Error reopening conversation:', error);
                      toast({
                        title: tConversations('header.toast.reopenFailed'),
                        variant: 'destructive',
                      });
                    },
                  },
                );
              }}
            >
              {isReopening
                ? tConversations('header.reopening')
                : tConversations('panel.unarchive')}
            </Button>
          </div>
        ) : conversation.status === 'spam' ? (
          <div className="border-border bg-muted/30 flex items-center justify-center gap-3 border-t px-8 py-3">
            <Text variant="muted" className="text-sm">
              {tConversations('panel.spamBanner')}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              disabled={isReopening}
              onClick={() => {
                reopenConversation(
                  {
                    conversationId: toId<'conversations'>(conversation.id),
                  },
                  {
                    onSuccess: () => {
                      toast({
                        title: tConversations('header.toast.reopened'),
                        variant: 'success',
                      });
                      onSelectedConversationChange(null);
                    },
                    onError: (error) => {
                      console.error('Error reopening conversation:', error);
                      toast({
                        title: tConversations('header.toast.reopenFailed'),
                        variant: 'destructive',
                      });
                    },
                  },
                );
              }}
            >
              {tConversations('panel.notSpam')}
            </Button>
          </div>
        ) : null}
      </PanelFooter>
    </div>
  );
}
