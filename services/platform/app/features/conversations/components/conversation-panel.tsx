'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Center, Row, Stack, VStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  CircleCheckIcon,
  Loader2Icon,
  MessageSquareMoreIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';

import {
  useDeleteConversation,
  useDiscardOutboundMessage,
  useDownloadAttachments,
  useGenerateUploadUrl,
  useMarkAsRead,
  useReopenConversation,
  useRetrySendMessage,
  useSendMessageViaConnector,
  useUndoSendMessage,
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
import { cn } from '@/lib/utils/cn';
import { groupMessagesByDate } from '@/lib/utils/conversation/date-utils';

interface AttachedFile {
  id: string;
  file: File | null;
  type: 'image' | 'video' | 'audio' | 'document';
}

// Placeholder message bubbles for the loading window — no real messages exist
// yet, so these synthetic rows stand in (each masked at its leaves). Sized to
// mirror real `Message` bubbles so the swap into real content doesn't shift.
const PLACEHOLDER_MESSAGE_BUBBLES: Array<{
  align: 'start' | 'end';
  bubbleClassName: string;
  withTimestamp?: boolean;
}> = [
  {
    align: 'start',
    bubbleClassName: 'h-24 w-96 max-w-full',
    withTimestamp: true,
  },
  { align: 'end', bubbleClassName: 'h-20 w-80 max-w-full' },
  {
    align: 'start',
    bubbleClassName: 'h-16 w-72 max-w-full',
    withTimestamp: true,
  },
];

interface ConversationPanelProps {
  selectedConversationId: string | null;
  onSelectedConversationChange: (conversationId: string | null) => void;
  status?: 'open' | 'closed' | 'archived' | 'spam';
  /**
   * Force the loading (masked) state regardless of selection — used by the
   * parent while the conversation LIST is still loading its first page, so the
   * panel shows masked placeholders instead of the "no selection" empty state.
   */
  forceLoading?: boolean;
}

export function ConversationPanel({
  selectedConversationId,
  onSelectedConversationChange,
  status: tabStatus,
  forceLoading = false,
}: ConversationPanelProps) {
  // Translations
  const { t: tConversations } = useT('conversations');
  const { formatDateHeader } = useFormatDate();

  const {
    data: conversation,
    isLoading: isQueryLoading,
    isError,
    error: loadError,
    refetch,
  } = useConversationWithMessages(selectedConversationId);

  // Surface the underlying load failure — the UI only renders a generic
  // "something went wrong", so without this the real error (e.g. a Convex
  // document that fails schema validation) is invisible in the console. Never
  // swallow it (repo rule: log or re-throw).
  useEffect(() => {
    if (isError) {
      console.error(
        'Failed to load conversation',
        selectedConversationId,
        loadError,
      );
    }
  }, [isError, loadError, selectedConversationId]);

  // Loading when the query is in flight OR the parent forces it (list still
  // loading its first page). Drives the single-tree masked render below.
  const isLoading = isQueryLoading || forceLoading;

  const { mutate: markAsRead } = useMarkAsRead();
  const { mutateAsync: sendMessageViaConnector } = useSendMessageViaConnector();
  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl();
  const { mutate: downloadAttachments } = useDownloadAttachments();
  const { mutate: reopenConversation, isPending: isReopening } =
    useReopenConversation();
  const { mutate: deleteConversation, isPending: isDeleting } =
    useDeleteConversation();
  const { mutate: undoSendMessage } = useUndoSendMessage();
  const { mutate: retrySendMessage } = useRetrySendMessage();
  const { mutate: discardOutboundMessage } = useDiscardOutboundMessage();

  // Draft handed back by an undo-send: seeds the composer's pendingMessage so
  // the message the user just cancelled reappears exactly as they wrote it.
  const [restoredDraft, setRestoredDraft] = useState<
    { id: string; content: string } | undefined
  >(undefined);

  const { formatDate } = useFormatDate();

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
    sourceMarkdown?: string,
  ) => {
    if (!conversation) {
      return;
    }

    // A previous undo's draft has served its purpose the moment a new send
    // goes out — dropping it keeps the editor's re-seed effect from restoring
    // stale content after this send clears the composer.
    setRestoredDraft(undefined);

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

    const contactEmail = conversation.contact.email;

    if (!contactEmail || contactEmail === 'unknown@example.com') {
      console.error('No contact email found in conversation');
      throw new Error(tConversations('panel.contactEmailNotFound'));
    }

    const subject =
      conversation.subject || tConversations('panel.defaultSubject');

    const replySubject = tConversations('panel.replySubjectPrefix', {
      subject,
    });

    await sendMessageViaConnector({
      conversationId: toId<'conversations'>(conversation._id),
      organizationId: conversation.organizationId,
      connectorName: conversation.connectorName ?? 'outlook',
      content: message,
      to: [contactEmail],
      subject: replySubject,
      html: message,
      text: message.replace(/<[^>]*>/g, ''),
      ...(sourceMarkdown ? { sourceMarkdown } : {}),
      ...(uploadedAttachments?.length
        ? { attachments: uploadedAttachments }
        : {}),
    });
  };

  const handleUndoSend = (messageId: string) => {
    undoSendMessage(
      { messageId: toId<'conversationMessages'>(messageId) },
      {
        onSuccess: ({ sourceMarkdown }) => {
          if (sourceMarkdown) {
            setRestoredDraft({ id: messageId, content: sourceMarkdown });
          }
        },
        onError: (error) => {
          console.error('Failed to undo send:', error);
          toast({
            title: tConversations('panel.undoSendFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleRetrySend = (messageId: string) => {
    retrySendMessage(
      { messageId: toId<'conversationMessages'>(messageId) },
      {
        onError: (error) => {
          console.error('Failed to retry send:', error);
          toast({
            title: tConversations('panel.retrySendFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleDiscardOutbound = (messageId: string) => {
    discardOutboundMessage(
      { messageId: toId<'conversationMessages'>(messageId) },
      {
        onError: (error) => {
          console.error('Failed to discard message:', error);
          toast({
            title: tConversations('panel.discardMessageFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  // No selection (and not force-loading) → real empty state, never masked.
  if (!selectedConversationId && !isLoading) {
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
          onClick={() => void refetch()}
          className="mt-1"
        >
          <RefreshCwIcon className="mr-2 size-4" />
          {tConversations('panel.tryAgain')}
        </Button>
      </Center>
    );
  }

  // Resolved-but-missing is a real not-found state, never masked.
  if (!isLoading && !conversation) {
    return (
      <Center className="flex-1">
        <Text>{tConversations('panel.notFound')}</Text>
      </Center>
    );
  }

  const { messages } = conversation ?? { messages: [] };

  // All messages from the database have valid delivery states, no filtering needed
  const displayMessages = messages;

  // Create pending message from approval if it exists (emailBody only)
  const pendingMessage =
    conversation?.pendingApproval?.metadata &&
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

  // Status drives which footer banner the loading placeholder mirrors.
  const isInactiveTab =
    tabStatus === 'closed' || tabStatus === 'archived' || tabStatus === 'spam';

  // One real tree, always. While the conversation query resolves there is no
  // real conversation, so each slot (header, messages, footer) renders
  // placeholder markup with masked leaves inside <Skeletonize loading>; once
  // loaded the real ConversationHeader / Message / composer render in place.
  return (
    <Skeletonize
      loading={isLoading}
      // Skeletonize renders a wrapper <div>; it must carry the flex layout so
      // the scroller below can bound its height. Without this it collapses to a
      // plain block, the inner `overflow-y-auto` never engages, and the reading
      // pane grows past the viewport instead of scrolling.
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {/* The composer/banner footer is a flex SIBLING of the scroller — never
          inside the scroll container — so it cannot move with content. */}
      <Stack gap={0} className="relative min-h-0 flex-[1_1_0]">
        <Stack
          ref={containerRef}
          gap={0}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="bg-background sticky top-0 z-20">
            {conversation ? (
              <ConversationHeader
                conversation={conversation}
                organizationId={conversation.organizationId}
                onResolve={() => {
                  onSelectedConversationChange(null);
                }}
                onReopen={() => {
                  onSelectedConversationChange(null);
                }}
              />
            ) : (
              <Stack
                gap={3}
                className="border-border border-b p-4 sm:px-6 sm:py-4"
              >
                <Row justify="between">
                  <SkeletonBox>
                    <div className="h-5 w-64 max-w-full" />
                  </SkeletonBox>
                  <SkeletonBox>
                    <div className="size-7 shrink-0 rounded-md" />
                  </SkeletonBox>
                </Row>
                <div className="flex items-center gap-2.5">
                  <SkeletonBox>
                    <div className="size-8 shrink-0 rounded-full" />
                  </SkeletonBox>
                  <VStack className="gap-1">
                    <SkeletonBox>
                      <div className="h-3.5 w-28" />
                    </SkeletonBox>
                    <SkeletonBox>
                      <div className="h-3 w-44" />
                    </SkeletonBox>
                  </VStack>
                </div>
              </Stack>
            )}
          </div>
          <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-2">
            {!conversation ? (
              <>
                <div className="mb-4 py-2">
                  <Row gap={0} align="stretch" justify="center">
                    <SkeletonBox>
                      <div className="h-5 w-24 rounded-full" />
                    </SkeletonBox>
                  </Row>
                </div>
                <VStack gap={4} className="mb-8">
                  {PLACEHOLDER_MESSAGE_BUBBLES.map((row, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex',
                        row.align === 'start' ? 'justify-start' : 'justify-end',
                      )}
                    >
                      <div className="relative">
                        <SkeletonBox>
                          <div
                            className={cn(
                              'mb-2 rounded-2xl',
                              row.bubbleClassName,
                            )}
                          />
                        </SkeletonBox>
                        {row.withTimestamp && (
                          <SkeletonBox>
                            <div className="h-3 w-20" />
                          </SkeletonBox>
                        )}
                      </div>
                    </div>
                  ))}
                </VStack>
              </>
            ) : messageGroups.length === 0 ? (
              <Center className="h-full">
                <Text variant="muted">
                  {tConversations('panel.noMessages')}
                </Text>
              </Center>
            ) : (
              <>
                {showCollapse && (
                  <Row
                    gap={0}
                    align="stretch"
                    justify="center"
                    className="py-3"
                  >
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline"
                      onClick={() => setIsThreadCollapsed(false)}
                    >
                      {tConversations('panel.showEarlierMessages', {
                        count: collapsedHiddenCount,
                      })}
                    </button>
                  </Row>
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
                        <Row gap={0} align="stretch" justify="center">
                          <div className="bg-background border-border rounded-full border px-2 py-0.5 shadow-sm">
                            <Text
                              as="span"
                              variant="label-sm"
                              className="text-primary"
                            >
                              {formatDateHeader(group.date)}
                            </Text>
                          </div>
                        </Row>
                      </div>

                      {/* Messages for this date */}
                      <Stack gap={4} className="mb-8">
                        {messagesToShow.map((message) => (
                          <Message
                            key={message.id}
                            message={message}
                            onUndoSend={handleUndoSend}
                            onRetrySend={handleRetrySend}
                            onDiscard={handleDiscardOutbound}
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
                                      title: tConversations(
                                        'panel.downloadFailed',
                                      ),
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
        </Stack>
        {!conversation ? (
          isInactiveTab ? (
            <PanelFooter className="px-0 pt-3 pb-0">
              <Row gap={2} justify="center" className="border-t px-3 pt-3 pb-4">
                <SkeletonBox>
                  <div className="h-4 w-48" />
                </SkeletonBox>
                <SkeletonBox>
                  <div className="h-7 w-32 rounded-md" />
                </SkeletonBox>
              </Row>
            </PanelFooter>
          ) : (
            <PanelFooter className="px-4 py-3">
              <div className="mx-auto w-full max-w-3xl">
                <SkeletonBox fullWidth>
                  <div className="h-[5rem] w-full rounded-xl" />
                </SkeletonBox>
              </div>
            </PanelFooter>
          )
        ) : (
          <PanelFooter
            className={cn(
              'px-4 py-3',
              conversation.status !== 'open' && 'px-0 pb-0',
            )}
          >
            {conversation.status === 'open' ? (
              <div
                ref={messageComposerRef}
                className="mx-auto w-full max-w-3xl"
              >
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
                  pendingMessage={restoredDraft ?? pendingMessage}
                  hasMessageHistory={displayMessages.length > 0}
                  organizationId={conversation.organizationId}
                />
              </div>
            ) : conversation.status === 'closed' ? (
              <Row
                gap={2}
                justify="center"
                className="border-t border-gray-200 bg-gray-50 px-3 pt-3 pb-4 dark:border-gray-600 dark:bg-gray-900"
                role="status"
              >
                <CircleCheckIcon
                  className="size-4 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <span className="text-[13px] text-gray-500 dark:text-gray-400">
                  {conversation.resolved_at
                    ? tConversations('panel.closedBanner', {
                        date: formatDate(conversation.resolved_at, 'long'),
                      })
                    : tConversations('panel.closedBannerNoDate')}
                </span>
                <Button
                  variant="secondary"
                  disabled={isReopening}
                  className="h-auto px-3 py-1 text-[13px]"
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
              </Row>
            ) : conversation.status === 'archived' ? (
              <Row
                gap={2}
                justify="center"
                className="border-t border-gray-200 bg-gray-50 px-3 pt-3 pb-4 dark:border-gray-600 dark:bg-gray-900"
                role="status"
              >
                <ArchiveIcon
                  className="size-4 shrink-0 text-gray-500 dark:text-gray-500"
                  aria-hidden="true"
                />
                <span className="text-[13px] text-gray-500 dark:text-gray-400">
                  {tConversations('panel.archivedBanner')}
                </span>
                <Button
                  variant="secondary"
                  disabled={isReopening}
                  className="h-auto px-3 py-1 text-[13px]"
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
              </Row>
            ) : conversation.status === 'spam' ? (
              <Row
                gap={2}
                justify="center"
                className="border-t border-gray-200 bg-gray-50 px-3 pt-3 pb-4 dark:border-gray-600 dark:bg-gray-900"
                role="status"
              >
                <ShieldAlertIcon
                  className="size-4 shrink-0 text-red-500 dark:text-red-400"
                  aria-hidden="true"
                />
                <span className="text-[13px] text-gray-500 dark:text-gray-400">
                  {tConversations('panel.spamBanner')}
                </span>
                <Row gap={2}>
                  <Button
                    variant="secondary"
                    disabled={isReopening || isDeleting}
                    className="h-auto px-3 py-1 text-[13px]"
                    onClick={() => {
                      reopenConversation(
                        {
                          conversationId: toId<'conversations'>(
                            conversation.id,
                          ),
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
                            console.error(
                              'Error reopening conversation:',
                              error,
                            );
                            toast({
                              title: tConversations(
                                'header.toast.reopenFailed',
                              ),
                              variant: 'destructive',
                            });
                          },
                        },
                      );
                    }}
                  >
                    {tConversations('panel.notSpam')}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={isDeleting || isReopening}
                    className="h-auto px-3 py-1 text-[13px]"
                    onClick={() => {
                      deleteConversation(
                        {
                          conversationId: toId<'conversations'>(
                            conversation.id,
                          ),
                        },
                        {
                          onSuccess: () => {
                            toast({
                              title: tConversations('panel.deleteSuccess'),
                              variant: 'success',
                            });
                            onSelectedConversationChange(null);
                          },
                          onError: (error) => {
                            console.error(
                              'Error deleting conversation:',
                              error,
                            );
                            toast({
                              title: tConversations('panel.deleteFailed'),
                              variant: 'destructive',
                            });
                          },
                        },
                      );
                    }}
                  >
                    {isDeleting
                      ? tConversations('panel.deleting')
                      : tConversations('panel.delete')}
                  </Button>
                </Row>
              </Row>
            ) : null}
          </PanelFooter>
        )}
      </Stack>
    </Skeletonize>
  );
}
