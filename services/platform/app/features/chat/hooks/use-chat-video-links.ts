'use client';

import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useCallback, useMemo } from 'react';

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
  /** Returns the number of URLs ingested (0..3). Caller can show a
   * toast when input had more URLs than were ingested. */
  ingestUrlsFromText: (
    text: string,
    organizationId: string,
    userLocale?: string,
  ) => Promise<number>;
  cancelJob: (jobId: Id<'videoLinkJobs'>) => Promise<void>;
  retryJob: (jobId: Id<'videoLinkJobs'>) => Promise<void>;
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
      return true;
    });
  }, [queryResult]);

  const isAnyProcessing = useMemo(
    () => jobs.some((j) => NON_TERMINAL.has(j.displayStatus)),
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
          const code =
            err instanceof ConvexError &&
            typeof err.data === 'object' &&
            err.data !== null &&
            'code' in err.data
              ? String((err.data as { code: unknown }).code)
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
      await cancelMutation({ jobId });
    },
    [cancelMutation],
  );

  const retryJob = useCallback(
    async (jobId: Id<'videoLinkJobs'>) => {
      await retryMutation({ jobId });
    },
    [retryMutation],
  );

  return { jobs, isAnyProcessing, ingestUrlsFromText, cancelJob, retryJob };
}
