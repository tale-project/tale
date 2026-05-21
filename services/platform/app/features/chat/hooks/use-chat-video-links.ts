'use client';

import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { extractVideoUrls, normalizeUrlForHash } from '@/lib/shared/video-url';

/**
 * Reactive subscription on this thread's video-link jobs + ingest +
 * cancel + retry callbacks. The chip UI consumes `jobs`; the send-gate
 * watches `isAnyProcessing`.
 *
 * `isAnyProcessing` is derived PURELY from the reactive query — no
 * in-memory "just-added" set. The mutation enqueues the row before
 * returning, so the reactive subscription picks up the new job
 * within one tick of the optimistic local update fired by Convex.
 */
export interface VideoLinkJob {
  jobId: Id<'videoLinkJobs'>;
  /** Original https:// URL the user pasted. Used by the chip's
   * "open source" affordance — once `pastedToken` is stripped from the
   * textarea on cancel, the user has no other way back to the video. */
  sourceUrl: string;
  sourcePlatform: string;
  pastedToken: string;
  videoTitle?: string;
  videoUploader?: string;
  videoDurationSec?: number;
  transcriptSource?: string;
  captionLang?: string;
  displayStatus: string;
  progress?: string;
  errorReasonCode?: string;
  errorMessage?: string;
  attempts?: number;
  storageId?: Id<'_storage'>;
  /** Size of the transcript blob from `fileMetadata.size`. Surfaced so the
   * client optimistic-render path (use-send-message.ts) can stamp the
   * same value the bind mutation puts on the outgoing attachment — keeps
   * the optimistic and persisted bubble bodies byte-identical. */
  fileSize?: number;
  lifecycleStatus?: string;
  messageBoundAt?: number;
  uploadedBy: string;
  createdAt: number;
}

const NON_TERMINAL: ReadonlySet<string> = new Set([
  'queued',
  'retrying',
  'fetching_metadata',
  'fetching_captions',
  'extracting_audio',
  'transcribing_handoff',
  'indexing',
]);

export interface UseChatVideoLinksResult {
  jobs: VideoLinkJob[];
  isAnyProcessing: boolean;
  /** True when any chip is in a terminal `failed` state. The send-gate
   * blocks send while this is true so the user explicitly retries /
   * removes the failed chip instead of unwittingly shipping a message
   * without the transcript (round-2 V10 / HIGH #18). */
  hasFailedJobs: boolean;
  /** Returns the number of URLs ingested (0..3). Caller can show a
   * toast when input had more URLs than were ingested. */
  ingestUrlsFromText: (
    text: string,
    organizationId: string,
    userLocale?: string,
  ) => Promise<number>;
  cancelJob: (jobId: Id<'videoLinkJobs'>) => Promise<void>;
  retryJob: (jobId: Id<'videoLinkJobs'>) => Promise<void>;
  /** Hide chips synchronously on send-click. Without this, the chip
   * stays in the composer until the server `bindCompletedJobsToMessage`
   * mutation patches `messageBoundAt` and the Convex subscription
   * re-fires — a 200–400 ms gap the user reads as "composer not
   * clearing". Pair with `unmarkJobsSent` on the send-failure rollback
   * path. */
  markJobsSent: (jobIds: Array<Id<'videoLinkJobs'>>) => void;
  unmarkJobsSent: (jobIds: Array<Id<'videoLinkJobs'>>) => void;
}

export function useChatVideoLinks(args: {
  threadId: string | undefined;
  organizationId: string | undefined;
}): UseChatVideoLinksResult {
  const { t: tChat } = useT('chat');

  // Two subscriptions, mutually exclusive:
  //   - in a thread → listForThread by threadId
  //   - welcome page (no thread yet) → listForUserUnboundChat by org+user
  // On first send the bind mutation patches threadId, so rows naturally
  // migrate from the unbound query to the threadId one — Convex
  // reactivity rebinds both queries with no chip flicker.
  const threadResult = useQuery(
    api.video_links.queries.listForThread,
    args.threadId && args.organizationId
      ? { threadId: args.threadId, organizationId: args.organizationId }
      : 'skip',
  );
  const unboundResult = useQuery(
    api.video_links.queries.listForUserUnboundChat,
    !args.threadId && args.organizationId
      ? { organizationId: args.organizationId }
      : 'skip',
  );
  const queryResult = args.threadId ? threadResult : unboundResult;

  const ingestMutation = useMutation(api.video_links.mutations.ingestVideoUrl);
  const cancelMutation = useMutation(api.video_links.mutations.cancelVideoLink);
  const retryMutation = useMutation(api.video_links.mutations.retryVideoLink);

  // Client-side "just-sent" set so chips can vanish in the same React
  // commit as `clearInputValue()` — without this the chip sits there for
  // the 50–200 ms it takes the bind mutation to round-trip and the
  // subscription to re-emit with `messageBoundAt !== undefined`. The set
  // lives on the hook instance, dies on chat unmount, and is pruned by
  // the effect below once the subscription catches up (so we don't leak
  // entries even when bind succeeds normally).
  const [hideJobIds, setHideJobIds] = useState<
    ReadonlySet<Id<'videoLinkJobs'>>
  >(() => new Set());

  const markJobsSent = useCallback((jobIds: Array<Id<'videoLinkJobs'>>) => {
    if (jobIds.length === 0) return;
    setHideJobIds((prev) => {
      const next = new Set(prev);
      for (const id of jobIds) next.add(id);
      return next;
    });
  }, []);

  const unmarkJobsSent = useCallback((jobIds: Array<Id<'videoLinkJobs'>>) => {
    if (jobIds.length === 0) return;
    setHideJobIds((prev) => {
      if (jobIds.every((id) => !prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of jobIds) next.delete(id);
      return next;
    });
  }, []);

  // Prune `hideJobIds` once the subscription catches up: keep only ids
  // whose row is still visible in `queryResult` AND not yet bound. The
  // subscription's own filter would also drop bound rows, so the cleanup
  // here is what stops the set from growing unboundedly across many
  // sends in a long-lived chat session.
  useEffect(() => {
    if (!queryResult) return;
    setHideJobIds((prev) => {
      if (prev.size === 0) return prev;
      const visibleUnbound = new Set<Id<'videoLinkJobs'>>();
      for (const j of queryResult) {
        if (j.messageBoundAt === undefined) {
          visibleUnbound.add(j.jobId);
        }
      }
      let mutated = false;
      const next = new Set<Id<'videoLinkJobs'>>();
      for (const id of prev) {
        if (visibleUnbound.has(id)) {
          next.add(id);
        } else {
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [queryResult]);

  const jobs = useMemo<VideoLinkJob[]>(() => {
    if (!queryResult) return [];
    return queryResult.filter((j) => {
      // Hide cancelled chips from the composer immediately. The DB row
      // stays (audit trail + cleanup action drops the blob async); we
      // just don't render it.
      if (j.displayStatus === 'skipped') return false;
      // Hide message-bound jobs from the draft chip area — once the
      // bindCompletedJobsToMessage mutation has stamped messageBoundAt,
      // the chip belongs to the sent message bubble, not the composer.
      if (j.messageBoundAt !== undefined) return false;
      // Soft-delete (trashed/expired/deleted) — hide as well.
      if (j.lifecycleStatus === 'trashed') return false;
      // Client-side "just-sent" hide for the same-frame composer empty
      // (see `hideJobIds` declaration above for the rationale).
      if (hideJobIds.has(j.jobId)) return false;
      return true;
    });
  }, [queryResult, hideJobIds]);

  const isAnyProcessing = useMemo(
    () => jobs.some((j) => NON_TERMINAL.has(j.displayStatus)),
    [jobs],
  );
  const hasFailedJobs = useMemo(
    () => jobs.some((j) => j.displayStatus === 'failed'),
    [jobs],
  );

  const ingestUrlsFromText = useCallback(
    async (
      text: string,
      organizationId: string,
      userLocale?: string,
    ): Promise<number> => {
      const matches = extractVideoUrls(text, { maxUrls: 3 });
      let ingested = 0;
      for (const match of matches) {
        try {
          await ingestMutation({
            organizationId,
            // Welcome-page paste: omit threadId so the row enters the
            // listForUserUnboundChat subscription. bindCompletedJobsToMessage
            // patches threadId on the first send.
            ...(args.threadId ? { threadId: args.threadId } : {}),
            url: match.url,
            pastedToken: match.pastedToken,
            normalizedUrl: normalizeUrlForHash(match.url),
            sourcePlatform: match.platform,
            userLocale,
          });
          ingested += 1;
        } catch (err) {
          // Surface the rejection to the user. ConvexError carries a
          // structured `code` that maps 1:1 to `videoLink.errors.*` keys;
          // unstructured errors fall back to the generic copy.
          // After the `instanceof ConvexError`, type-check, and
          // `'code' in err.data` narrowings, TS already knows
          // `err.data.code: unknown` — no cast required.
          const code =
            err instanceof ConvexError &&
            typeof err.data === 'object' &&
            err.data !== null &&
            'code' in err.data
              ? String(err.data.code)
              : undefined;
          toast({
            title: tChat('videoLink.toast.ingestFailedTitle'),
            description: tChat(
              code ? `videoLink.errors.${code}` : 'videoLink.errors.generic',
            ),
            variant: 'destructive',
          });
          console.error(
            '[useChatVideoLinks] ingest failed:',
            err instanceof Error ? err.message : err,
          );
        }
      }
      return ingested;
    },
    [args.threadId, ingestMutation, tChat],
  );

  const cancelJob = useCallback(
    async (jobId: Id<'videoLinkJobs'>) => {
      // Hide the chip first so the click feels instant. The server
      // mutation flips status='skipped' (including for terminal rows),
      // but the subscription's re-emit lags the round-trip by 50-200ms
      // — the local hide bridges that gap so the X feels immediate.
      // Reverted on mutation failure (catch block below).
      setHideJobIds((prev) => {
        if (prev.has(jobId)) return prev;
        const next = new Set(prev);
        next.add(jobId);
        return next;
      });
      try {
        await cancelMutation({ jobId });
      } catch (err) {
        setHideJobIds((prev) => {
          if (!prev.has(jobId)) return prev;
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        console.error(
          '[useChatVideoLinks] cancel failed:',
          err instanceof Error ? err.message : err,
        );
        throw err;
      }
    },
    [cancelMutation],
  );

  const retryJob = useCallback(
    async (jobId: Id<'videoLinkJobs'>) => {
      await retryMutation({ jobId });
    },
    [retryMutation],
  );

  return {
    jobs,
    isAnyProcessing,
    hasFailedJobs,
    ingestUrlsFromText,
    cancelJob,
    retryJob,
    markJobsSent,
    unmarkJobsSent,
  };
}
