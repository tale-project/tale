'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Center, Row, Stack, VStack } from '@tale/ui/layout';
import { lazyComponent } from '@tale/ui/lazy-component';
import { PanelFooter } from '@tale/ui/panel-footer';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';

import { HomePanelToggle } from '@/app/features/home/components/home-panel-toggle';
import { useDocumentTitle } from '@/app/hooks/use-document-title';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { backendErrorFromResponse } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteConversation,
  useDiscardOutboundMessage,
  useDiscardSuggestedReply,
  useGenerateUploadUrl,
  useMarkAsRead,
  useReopenConversation,
  useRetrySendMessage,
  useSendMessageViaConnector,
  useUndoSendMessage,
} from '../hooks/mutations';
import { useConversationWithMessages, useMailboxes } from '../hooks/queries';
import { channelSourceOf } from '../lib/channel-source';
import {
  ConversationHeader,
  ConversationHeaderSkeleton,
} from './conversation-header';
import { MessageTimestamp } from './conversation-message-layout';
import { InboxMobileBackButton } from './inbox-mobile-back-button';
import { Message } from './message';
import { MessageEditorPlaceholder } from './message-editor/message-editor-placeholder';
import {
  type AttachedFile,
  type MessageEditorProps,
  type StoredAttachment,
  storedAttachedFile,
} from './message-editor/types';
import { SuggestedReplyCard } from './suggested-reply-card';

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
import { ThreadDayDivider } from '@tale/ui/thread/thread-day-divider';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useSwapFade } from '@tale/ui/use-swap-fade';

import { groupMessagesByDate } from '@/lib/utils/conversation/date-utils';
import { documentTitle } from '@/lib/utils/seo';

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
  const { mailboxes } = useMailboxes();

  const { formatDateHeader } = useFormatDate();

  const {
    data: conversation,
    isLoading: isQueryLoading,
    isError,
    error: loadError,
    refetch,
  } = useConversationWithMessages(selectedConversationId);
  // The next conversation opening in place fades in, as another chat does.
  const swapRef = useSwapFade<HTMLDivElement>(
    selectedConversationId ?? undefined,
  );
  // The tab names the conversation, as a chat's and a task's do.
  useDocumentTitle(
    conversation?.title
      ? documentTitle('conversations', conversation.title)
      : undefined,
  );
  // Where a reply leaves from. The server derives the route — down to the
  // mailbox — from the conversation's own stamps, so this states the outcome
  // rather than choosing it: the composer cannot send anywhere else.
  const replyDestination = useMemo(() => {
    if (!conversation) return undefined;
    const source = channelSourceOf(conversation, mailboxes);
    if (source.lane === 'unknown') {
      return tConversations('header.replyViaUnknown');
    }
    const name = source.label ?? tConversations('header.apiSourceShort');
    return source.lane === 'api'
      ? tConversations('header.replyViaApi', { source: name })
      : tConversations('header.replyVia', { source: name });
  }, [conversation, mailboxes, tConversations]);

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
  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl({
    errorToast: false,
  });
  const { mutate: reopenConversation, isPending: isReopening } =
    useReopenConversation();
  const { mutate: deleteConversation, isPending: isDeleting } =
    useDeleteConversation();
  const { mutate: undoSendMessage } = useUndoSendMessage();
  const { mutate: retrySendMessage } = useRetrySendMessage();
  const { mutate: discardOutboundMessage } = useDiscardOutboundMessage();
  const discardSuggestedReply = useDiscardSuggestedReply(
    conversation?.organizationId,
  );

  // A one-time seed for the composer: a send the person undid, or a suggested
  // reply they chose to put in the editor. Once applied, the editor persists
  // its body and this panel keeps its live files per conversation, including
  // removals.
  const [restoredDrafts, setRestoredDrafts] = useState<
    Record<string, { seed: MessageEditorProps['pendingMessage'] }>
  >({});
  // The suggested reply (by approval id) a person put into the editor, per
  // conversation: from then on the composer's text is theirs, and the card
  // only says so.
  const [usedSuggestions, setUsedSuggestions] = useState<
    Record<string, string>
  >({});
  const [draftAttachments, setDraftAttachments] = useState<
    Record<string, AttachedFile[]>
  >({});

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
      // Delivery/backfill timestamps can precede the read marker. The server's
      // unread counter is also what the Inbox uses to filter unread threads.
      const hasUnreadMessages = conversation.unread_count > 0;

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

    let uploadedAttachments: StoredAttachment[] | undefined;

    if (attachments && attachments.length > 0) {
      // A failed upload must reject onSave: the editor retains the draft
      // and owns the one failure toast for both upload and send.
      const validAttachments = attachments.filter((a) => a.file || a.stored);
      if (validAttachments.length !== attachments.length) {
        throw new Error(tConversations('panel.invalidFileAttachment'));
      }

      uploadedAttachments = await Promise.all(
        validAttachments.map(async (attachment) => {
          if (attachment.stored) return attachment.stored;
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
            // Keep the door's refusal for the editor's failure toast.
            throw await backendErrorFromResponse(result);
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
    const conversationId = conversation?.id;
    if (conversationId === undefined) return;
    undoSendMessage(
      { messageId: messageId },
      {
        onSuccess: ({ sourceMarkdown, attachments }) => {
          // An attachment-only reply has no markdown to hand back; its files
          // alone are the draft.
          const files = (attachments ?? []).map(storedAttachedFile);
          if (sourceMarkdown || files.length > 0) {
            setRestoredDrafts((drafts) => ({
              ...drafts,
              [conversationId]: {
                seed: {
                  id: messageId,
                  content: sourceMarkdown ?? '',
                  attachments: files,
                },
              },
            }));
          }
        },
      },
    );
  };

  const handleRetrySend = (messageId: string) => {
    retrySendMessage({ messageId: messageId });
  };

  const handleDiscardOutbound = (messageId: string) => {
    discardOutboundMessage({ messageId: messageId });
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

  // An automation's drafted reply (the pending `conversations` approval whose
  // metadata carries `emailBody`) is a suggestion beside the composer, never
  // the composer's own text: the person puts it in the editor or discards it.
  const suggestedReply =
    conversation?.pendingApproval?.metadata &&
    typeof conversation.pendingApproval.metadata === 'object' &&
    'emailBody' in conversation.pendingApproval.metadata &&
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata shape verified by 'emailBody' in check above
    typeof (conversation.pendingApproval.metadata as { emailBody: unknown })
      .emailBody === 'string'
      ? {
          approvalId: conversation.pendingApproval._id,
          body:
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to a string just above
            (conversation.pendingApproval.metadata as { emailBody: string })
              .emailBody,
        }
      : undefined;

  const restoredDraft = conversation
    ? restoredDrafts[conversation.id]
    : undefined;

  const handleUseSuggestedReply = () => {
    if (!conversation || suggestedReply === undefined) return;
    const conversationId = conversation.id;
    setRestoredDrafts((drafts) => ({
      ...drafts,
      [conversationId]: {
        seed: { id: suggestedReply.approvalId, content: suggestedReply.body },
      },
    }));
    setUsedSuggestions((used) => ({
      ...used,
      [conversationId]: suggestedReply.approvalId,
    }));
  };

  const handleDiscardSuggestedReply = () => {
    if (suggestedReply === undefined) return;
    discardSuggestedReply.mutate({
      approvalId: suggestedReply.approvalId,
      status: 'rejected',
    });
  };

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
      className="mobile-nav-clearance mobile-nav-inset flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {/* The composer/banner footer is a flex SIBLING of the scroller — never
          inside the scroll container — so it cannot move with content. */}
      <Stack ref={swapRef} gap={0} className="relative min-h-0 flex-[1_1_0]">
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
                before={
                  <>
                    <HomePanelToggle />
                    <InboxMobileBackButton />
                  </>
                }
                onResolve={() => {
                  onSelectedConversationChange(null);
                }}
                onReopen={() => {
                  onSelectedConversationChange(null);
                }}
              />
            ) : (
              <ConversationHeaderSkeleton
                before={
                  <>
                    <HomePanelToggle />
                    <InboxMobileBackButton />
                  </>
                }
              />
            )}
          </div>
          <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-2">
            {!conversation ? (
              <>
                <ThreadDayDivider>
                  <span className="inline-block w-20">{'\u00a0'}</span>
                </ThreadDayDivider>
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
                      <ThreadDayDivider>
                        {formatDateHeader(group.date)}
                      </ThreadDayDivider>

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
                className="mx-auto flex w-full max-w-3xl flex-col gap-3"
              >
                {suggestedReply !== undefined && (
                  <SuggestedReplyCard
                    body={suggestedReply.body}
                    used={
                      usedSuggestions[conversation.id] ===
                      suggestedReply.approvalId
                    }
                    discarding={discardSuggestedReply.isPending}
                    onUse={handleUseSuggestedReply}
                    onDiscard={handleDiscardSuggestedReply}
                  />
                )}
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
                  pendingMessage={restoredDraft?.seed}
                  attachments={draftAttachments[conversation.id] ?? []}
                  onAttachmentsChange={(next: SetStateAction<AttachedFile[]>) =>
                    setDraftAttachments((current) => ({
                      ...current,
                      [conversation.id]:
                        typeof next === 'function'
                          ? next(current[conversation.id] ?? [])
                          : next,
                    }))
                  }
                  onPendingMessageApplied={(
                    applied: NonNullable<MessageEditorProps['pendingMessage']>,
                  ) =>
                    setRestoredDrafts((current) => {
                      const draft = current[conversation.id];
                      return draft?.seed === applied
                        ? {
                            ...current,
                            [conversation.id]: { ...draft, seed: undefined },
                          }
                        : current;
                    })
                  }
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
