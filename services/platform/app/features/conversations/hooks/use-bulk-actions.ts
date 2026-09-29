import { toast } from '@tale/ui/use-toast';
import type { TFunction } from 'i18next';
import { useState, useCallback } from 'react';

import { failureDetail, firstFailureDetail } from '@/app/lib/backend/adapters';
import type { ConversationItem } from '@/backend/core/conversations/types';
import { useT } from '@/lib/i18n/client';
import { bulkConversationBatches } from '@/lib/shared/conversations/bulk-limit';

import type { SelectionState } from '../types/selection';
import { isAllSelection } from '../types/selection';
import {
  useBulkArchiveConversations,
  useBulkCloseConversations,
  useBulkReopenConversations,
  useBulkSpamConversations,
  useBulkUnarchiveConversations,
  useSendMessageViaConnector,
} from './mutations';

const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

export function getSelectedConversationIds(
  selectionState: SelectionState,
  conversations: ConversationItem[],
) {
  // Intersect the selected ids with the currently-visible (filtered)
  // conversations so bulk actions only ever touch rows the user can see.
  // This keeps a narrowed search from silently mutating now-hidden rows.
  return isAllSelection(selectionState)
    ? conversations.map((c) => c._id)
    : conversations
        .filter((c) => selectionState.selectedIds.has(c.id))
        .map((c) => c._id);
}

function getSelectedConversations(
  selectionState: SelectionState,
  conversations: ConversationItem[],
) {
  return isAllSelection(selectionState)
    ? conversations
    : conversations.filter((c) => selectionState.selectedIds.has(c._id));
}

/** What the bulk door answers for one batch. */
interface BulkResult {
  successCount: number;
  failedCount: number;
  errors: string[];
}

/** How far a bulk verb has got: the selected conversations its settled
 * requests named, out of all of them. */
export interface BulkProgress {
  settled: number;
  total: number;
}

/** What one bulk verb over a selection came to. */
interface BulkOutcome {
  successCount: number;
  failedCount: number;
  /** How many of the conversations the door answered for, either way. */
  answeredCount: number;
  /** The conversations a refused request named — the ones to try again. */
  unsettledIds: string[];
  /** Why the first refused request was refused. */
  firstError?: unknown;
}

/**
 * One bulk verb over `ids`, in consecutive requests of at most
 * `BULK_CONVERSATION_LIMIT` — the most the door takes, so a selection of
 * any size can go out. A refused request counts every conversation it named
 * as failed and leaves them unsettled; the requests after it still go.
 */
async function runBulkInBatches(
  ids: readonly string[],
  send: (conversationIds: string[]) => Promise<BulkResult>,
  onProgress: (progress: BulkProgress) => void,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = {
    successCount: 0,
    failedCount: 0,
    answeredCount: 0,
    unsettledIds: [],
  };
  let settled = 0;
  onProgress({ settled, total: ids.length });
  for (const batch of bulkConversationBatches(ids)) {
    try {
      const result = await send(batch);
      outcome.successCount += result.successCount;
      outcome.failedCount += result.failedCount;
      outcome.answeredCount += batch.length;
    } catch (error) {
      console.error('A bulk conversation request was refused:', error);
      outcome.failedCount += batch.length;
      outcome.unsettledIds.push(...batch);
      outcome.firstError ??= error;
    }
    settled += batch.length;
    onProgress({ settled, total: ids.length });
  }
  return outcome;
}

interface UseBulkActionsOptions {
  organizationId: string;
  conversations: ConversationItem[];
  selectionState: SelectionState;
  /**
   * After a verb changed at least one conversation. `unsettledIds` are the
   * ones a refused request named: they stay selected for another try.
   */
  onComplete: (unsettledIds: readonly string[]) => void;
}

/**
 * A bulk summary's counts, and why the first refused request was refused
 * when the refusal says. Each request stays quiet at its hook, so the
 * summary is the batch's only report of the reason.
 */
function withReason(
  tConversations: TFunction,
  outcome: string,
  reason: string | undefined,
): string {
  return reason === undefined
    ? outcome
    : tConversations('bulk.outcomeWithReason', { outcome, reason });
}

/** The copy one status verb's outcome reads in: title on success, the
 * description with its counts, and the title when nothing changed. */
interface VerbCopy {
  done: string;
  description: string;
  failed: string;
}

export function useBulkActions({
  organizationId,
  conversations,
  selectionState,
  onComplete,
}: UseBulkActionsOptions) {
  const { t: tConversations } = useT('conversations');

  // The outcome toast below says what happened to the whole selection, so
  // a refused batch must not raise the generic failure toast of its own.
  const quiet = { errorToast: false } as const;
  const { mutateAsync: bulkArchive } = useBulkArchiveConversations(quiet);
  const { mutateAsync: bulkResolve } = useBulkCloseConversations(quiet);
  const { mutateAsync: bulkReopen } = useBulkReopenConversations(quiet);
  const { mutateAsync: bulkSpam } = useBulkSpamConversations(quiet);
  const { mutateAsync: bulkUnarchive } = useBulkUnarchiveConversations(quiet);
  const { mutateAsync: sendMessageViaConnector } = useSendMessageViaConnector();

  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkSendDialog, setBulkSendDialog] = useState({
    isOpen: false,
    isSending: false,
  });

  const openBulkSendDialog = useCallback(() => {
    setBulkSendDialog({ isOpen: true, isSending: false });
  }, []);

  const closeBulkSendDialog = useCallback(() => {
    setBulkSendDialog({ isOpen: false, isSending: false });
  }, []);

  const handleSendMessages = useCallback(
    async (message: string) => {
      if (isBulkProcessing) return;

      const body = message.trim();
      if (!body) return;

      setIsBulkProcessing(true);
      setBulkSendDialog({ isOpen: true, isSending: true });

      try {
        const selectedConversations = getSelectedConversations(
          selectionState,
          conversations,
        );

        // Dispatch a real reply to each contact through the conversation's
        // connector — mirroring the single-conversation reply path. A
        // conversation without a usable contact email cannot be delivered, so
        // it is counted as a failure rather than silently dropped.
        const results = await Promise.allSettled(
          selectedConversations.map((conversation) => {
            const contactEmail = conversation.contact.email;
            if (!contactEmail || contactEmail === UNKNOWN_CONTACT_EMAIL) {
              return Promise.reject(
                new Error(tConversations('panel.contactEmailNotFound')),
              );
            }

            // Content only: the reply door derives the connector, recipient
            // and subject from each conversation, so an envelope assembled
            // here never left the browser.
            return sendMessageViaConnector({
              conversationId: conversation._id,
              organizationId,
              content: body,
            });
          }),
        );

        // In selection order, so the summary names the first refusal.
        const reasons = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => r.reason);
        const failedCount = reasons.length;
        const successCount = results.length - failedCount;

        toast({
          title: tConversations('bulk.messagesSent'),
          description: withReason(
            tConversations,
            tConversations('bulk.messagesSentDescription', {
              successCount,
              failedCount,
            }),
            failedCount > 0 ? firstFailureDetail(reasons) : undefined,
          ),
          variant: successCount > 0 ? 'default' : 'destructive',
        });

        setBulkSendDialog({ isOpen: false, isSending: false });
        onComplete([]);
      } catch (error) {
        console.error('Error sending messages:', error);
        toast({
          title: tConversations('bulk.sendFailed'),
          variant: 'destructive',
        });
        setBulkSendDialog({ isOpen: false, isSending: false });
      } finally {
        setIsBulkProcessing(false);
      }
    },
    [
      isBulkProcessing,
      selectionState,
      conversations,
      sendMessageViaConnector,
      organizationId,
      tConversations,
      onComplete,
    ],
  );

  /**
   * The five status verbs, one way: the selection goes out in batches the
   * door takes, the busy state and the progress hold until the last one
   * settles, and the toast states what the whole selection came to and why
   * the first refused batch was refused. A refused batch keeps its
   * conversations selected; when nothing changed at all, the selection stays
   * as it was.
   */
  const runStatusVerb = useCallback(
    async (
      send: (args: { conversationIds: string[] }) => Promise<BulkResult>,
      copy: VerbCopy,
    ) => {
      if (isBulkProcessing) return;

      setIsBulkProcessing(true);
      try {
        const outcome = await runBulkInBatches(
          getSelectedConversationIds(selectionState, conversations),
          (conversationIds) => send({ conversationIds }),
          setBulkProgress,
        );
        if (outcome.answeredCount === 0) {
          const reason = failureDetail(outcome.firstError);
          toast({
            title: tConversations(copy.failed),
            ...(reason !== undefined ? { description: reason } : {}),
            variant: 'destructive',
          });
          return;
        }

        toast({
          title: tConversations(copy.done),
          description: withReason(
            tConversations,
            tConversations(copy.description, {
              successCount: outcome.successCount,
              failedCount: outcome.failedCount,
            }),
            failureDetail(outcome.firstError),
          ),
          variant: outcome.successCount > 0 ? 'default' : 'destructive',
        });
        // The requests name rows by `_id`; the selection keeps their `id`.
        const selectionIdOf = new Map(
          conversations.map((row) => [row._id, row.id]),
        );
        onComplete(
          outcome.unsettledIds.map((_id) => selectionIdOf.get(_id) ?? _id),
        );
      } catch (error) {
        console.error('Error running a bulk conversation verb:', error);
        toast({ title: tConversations(copy.failed), variant: 'destructive' });
      } finally {
        setIsBulkProcessing(false);
        setBulkProgress(null);
      }
    },
    [
      isBulkProcessing,
      selectionState,
      conversations,
      tConversations,
      onComplete,
    ],
  );

  const handleBulkResolve = useCallback(
    () =>
      runStatusVerb(bulkResolve, {
        done: 'bulk.resolved',
        description: 'bulk.resolvedDescription',
        failed: 'bulk.resolveFailed',
      }),
    [runStatusVerb, bulkResolve],
  );

  const handleBulkReopen = useCallback(
    () =>
      runStatusVerb(bulkReopen, {
        done: 'bulk.reopened',
        description: 'bulk.reopenedDescription',
        failed: 'bulk.reopenFailed',
      }),
    [runStatusVerb, bulkReopen],
  );

  const handleBulkSpam = useCallback(
    () =>
      runStatusVerb(bulkSpam, {
        done: 'bulk.markedAsSpam',
        description: 'bulk.markedAsSpamDescription',
        failed: 'bulk.spamFailed',
      }),
    [runStatusVerb, bulkSpam],
  );

  const handleBulkArchive = useCallback(
    () =>
      runStatusVerb(bulkArchive, {
        done: 'bulk.archived',
        description: 'bulk.archivedDescription',
        failed: 'bulk.archiveFailed',
      }),
    [runStatusVerb, bulkArchive],
  );

  const handleBulkUnarchive = useCallback(
    () =>
      runStatusVerb(bulkUnarchive, {
        done: 'bulk.unarchived',
        description: 'bulk.unarchivedDescription',
        failed: 'bulk.unarchiveFailed',
      }),
    [runStatusVerb, bulkUnarchive],
  );

  return {
    isBulkProcessing,
    bulkProgress,
    bulkSendDialog,
    openBulkSendDialog,
    closeBulkSendDialog,
    handleSendMessages,
    handleBulkResolve,
    handleBulkReopen,
    handleBulkSpam,
    handleBulkArchive,
    handleBulkUnarchive,
  };
}
