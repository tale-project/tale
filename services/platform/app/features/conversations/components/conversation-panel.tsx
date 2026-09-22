'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Center, Row, Stack, VStack } from '@tale/ui/layout';
import { lazyComponent } from '@tale/ui/lazy-component';
import { PanelFooter } from '@tale/ui/panel-footer';
import { SkeletonBox, SkeletonCircle, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import {
  AlertTriangleIcon,
  ArchiveIcon,
  CircleCheckIcon,
  MessageSquareMoreIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteConversation,
  useDiscardOutboundMessage,
  useGenerateUploadUrl,
  useMarkAsRead,
  useReopenConversation,
  useRetrySendMessage,
  useSendMessageViaConnector,
  useUndoSendMessage,
} from '../hooks/mutations';
import {
  useConnectorTitles,
  useConversationWithMessages,
} from '../hooks/queries';
import { channelSourceOf } from '../lib/channel-source';
import { ConversationHeader } from './conversation-header';
import {
  ConversationDateHeader,
  MessageTimestamp,
} from './conversation-message-layout';
import { Message } from './message';
import { MessageEditorPlaceholder } from './message-editor/message-editor-placeholder';

const MessageEditor = lazyComponent(
  () =>
    import('./message-editor').then((mod) => ({ default: mod.MessageEditor })),
  {
    loading: () => (
      <Skeletonize loading>
        <MessageEditorPlaceholder />
      </Skeletonize>
    ),
  },
);

import { cn } from '@tale/ui/cn';
import { useFormatDate } from '@tale/ui/use-format-date';

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
}> = [
  {
    align: 'start',
    bubbleClassName: 'h-24 w-96 max-w-full',
  },
  { align: 'end', bubbleClassName: 'h-20 w-80 max-w-full' },
  {
    align: 'start',
    bubbleClassName: 'h-16 w-72 max-w-full',
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
  const { titleOf: connectorTitleOf } = useConnectorTitles();

  const { formatDateHeader } = useFormatDate();

  const {
    data: conversation,
    isLoading: isQueryLoading,
    isError,
    error: loadError,
    refetch,
  } = useConversationWithMessages(selectedConversationId);
  // Where a reply leaves from. The server derives the route from the
  // conversation's own stamps, so this states the outcome rather than
  // choosing it: the composer cannot send anywhere else.
  const replyDestination = useMemo(() => {
    if (!conversation) return undefined;
    const source = channelSourceOf(conversation, connectorTitleOf);
    if (source.lane === 'unknown') {
      return tConversations('header.replyViaUnknown');
    }
    const name = source.label ?? tConversations('header.apiSourceShort');
    return source.lane === 'api'
      ? tConversations('header.replyViaApi', { source: name })
      : tConversations('header.replyVia', { source: name });
  }, [conversation, connectorTitleOf, tConversations]);

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
  const { mutate: reopenConversation, isPending: isReopening } =
    useReopenConversation();
  const { mutate: deleteConversation, isPending: isDeleting } =
    useDeleteConversation();
  const { mutate: undoSendMessage } = useUndoSendMessage();
  const { mutate: retrySendMessage } = useRetrySendMessage();
  const { mutate: discardOutboundMessage } = useDiscardOutboundMessage();

  // Draft handed back by an undo-send: seeds the composer's pendingMessage so
  // the message the user just cancelled reappears exactly as they wrote it.
  // Cleared via MessageEditor.onPendingMessageConsumed on a successful resend
  // (same turn as the editor remount) so the remount cannot re-seed from it.
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
          { conversationId: selectedConversationId },
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

    let uploadedAttachments:
      | Array<{
          storageId: string;
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
              storageId: rawStorageId,
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

    if (
      conversation.channel !== 'api' &&
      (!contactEmail || contactEmail === 'unknown@example.com')
    ) {
      console.error('No contact email found in conversation');
      throw new Error(tConversations('panel.contactEmailNotFound'));
    }

    // The door takes the content and derives everything else from the
    // conversation: `POST /conversations/:id/reply` accepts content,
    // sourceMarkdown and attachments alone, so a connector, recipient or
    // subject assembled here never left the browser.
    await sendMessageViaConnector({
      conversationId: conversation._id,
      organizationId: conversation.organizationId,
      content: message,
      ...(sourceMarkdown ? { sourceMarkdown } : {}),
      ...(uploadedAttachments?.length
        ? { attachments: uploadedAttachments }
        : {}),
    });
  };

  const handleUndoSend = (messageId: string) => {
    undoSendMessage(
      { messageId: messageId },
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
      { messageId: messageId },
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
      { messageId: messageId },
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
                <Row justify="between" gap={2} className="min-w-0">
                  <div className="w-64 min-w-0 text-base">
                    <SkeletonText />
                  </div>
                  <Row gap={2} className="shrink-0">
                    <SkeletonBox asChild>
                      <div className="size-8 rounded-lg md:w-24" />
                    </SkeletonBox>
                    <SkeletonBox asChild>
                      <div className="size-8 rounded-lg" />
                    </SkeletonBox>
                  </Row>
                </Row>
                <div className="flex items-center gap-2.5">
                  <SkeletonCircle asChild>
                    <div className="size-8 shrink-0 rounded-full" />
                  </SkeletonCircle>
                  <VStack gap={0} className="min-w-0 gap-px">
                    <Text className="w-28 max-w-full text-[13px] font-semibold">
                      <SkeletonText />
                    </Text>
                    <Text variant="caption" className="w-44 max-w-full">
                      <SkeletonText />
                    </Text>
                  </VStack>
                </div>
              </Stack>
            )}
          </div>
          <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-2">
            {!conversation ? (
              <>
                <ConversationDateHeader>
                  <span className="inline-block w-20">{'\u00a0'}</span>
                </ConversationDateHeader>
                <VStack gap={4} className="mb-8">
                  {PLACEHOLDER_MESSAGE_BUBBLES.map((row, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex',
                        row.align === 'start' ? 'justify-start' : 'justify-end',
                      )}
                    >
                      <div className="relative max-w-full">
                        <SkeletonBox asChild>
                          <div
                            className={cn(
                              'mb-2 rounded-2xl',
                              row.bubbleClassName,
                            )}
                          />
                        </SkeletonBox>
                        <MessageTimestamp isCustomer={row.align === 'start'}>
                          <span className="w-20">
                            <SkeletonText />
                          </span>
                        </MessageTimestamp>
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
                      <ConversationDateHeader>
                        {formatDateHeader(group.date)}
                      </ConversationDateHeader>

                      {/* Messages for this date */}
                      <Stack gap={4} className="mb-8">
                        {messagesToShow.map((message) => (
                          <Message
                            key={message.id}
                            message={message}
                            onUndoSend={handleUndoSend}
                            onRetrySend={handleRetrySend}
                            onDiscard={handleDiscardOutbound}
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
                <MessageEditorPlaceholder />
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
                  onPendingMessageConsumed={() => setRestoredDraft(undefined)}
                  hasMessageHistory={displayMessages.length > 0}
                  organizationId={conversation.organizationId}
                  {...(replyDestination !== undefined
                    ? { replyDestination }
                    : {})}
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
                        conversationId: conversation.id,
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
                        conversationId: conversation.id,
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
                          conversationId: conversation.id,
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
                          conversationId: conversation.id,
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
