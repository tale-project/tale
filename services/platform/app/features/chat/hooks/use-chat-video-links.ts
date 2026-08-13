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
 * Reactive subscription on this conversation's video-link jobs + ingest /
 * cancel / retry callbacks — the 0.3 chat hook against the `video_links`
 * backend that survived the rewrite intact. The chip UI consumes `jobs`;
 * the send path watches `isAnyProcessing` (deferred send) and
 * `hasFailedJobs` (send stays blocked until the user retries or removes).
 */
export interface VideoLinkJob {
  jobId: Id<'videoLinkJobs'>;
  /** Original https:// URL the user pasted — the chip's "open source"
   * affordance, the only way back once the token leaves the textarea. */
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
  /** Blob reference of the transcript/audio, once captured. */
  storageId?: string;
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

/** Structured `code` off a ConvexError rejection — maps 1:1 to
 * `videoLink.errors.*` keys; unstructured errors fall back to generic. */
function convexErrorCode(err: unknown): string | undefined {
  return err instanceof ConvexError &&
    typeof err.data === 'object' &&
    err.data !== null &&
    'code' in err.data
    ? String(err.data.code)
    : undefined;
}

export interface UseChatVideoLinksResult {
  jobs: VideoLinkJob[];
  isAnyProcessing: boolean;
  /** True while any chip sits in terminal `failed` — the send blocks so the
   * user explicitly retries or removes instead of unwittingly shipping the
   * message without the transcript. */
  hasFailedJobs: boolean;
  /** Ingests up to 3 video URLs found in `text`; returns how many. */
  ingestUrlsFromText: (text: string) => Promise<number>;
  cancelJob: (jobId: Id<'videoLinkJobs'>) => Promise<void>;
  retryJob: (jobId: Id<'videoLinkJobs'>) => Promise<void>;
  /** Hide chips synchronously on send-click; the server bind's subscription
   * re-emit lags the round-trip. Pair with `unmarkJobsSent` on rollback. */
  markJobsSent: (jobIds: Array<Id<'videoLinkJobs'>>) => void;
  unmarkJobsSent: (jobIds: Array<Id<'videoLinkJobs'>>) => void;
}

export function useChatVideoLinks(args: {
  threadId: string | undefined;
  organizationId: string;
  locale: string;
}): UseChatVideoLinksResult {
  const { t } = useT('chat');

  // Two subscriptions, mutually exclusive: in a thread → by threadId; on
  // the index (no thread yet) → the user's unbound rows. The first send
  // binds threadId, so rows migrate between the queries with no flicker.
  const threadResult = useQuery(
    api.video_links.queries.listForThread,
    args.threadId !== undefined
      ? { threadId: args.threadId, organizationId: args.organizationId }
      : 'skip',
  );
  const unboundResult = useQuery(
    api.video_links.queries.listForUserUnboundChat,
    args.threadId === undefined
      ? { organizationId: args.organizationId }
      : 'skip',
  );
  const queryResult =
    args.threadId !== undefined ? threadResult : unboundResult;

  const ingestMutation = useMutation(api.video_links.mutations.ingestVideoUrl);
  const cancelMutation = useMutation(api.video_links.mutations.cancelVideoLink);
  const retryMutation = useMutation(api.video_links.mutations.retryVideoLink);

  // Client-side "just-sent" set so chips vanish in the same commit as the
  // composer clearing; pruned once the subscription catches up.
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

  useEffect(() => {
    if (!queryResult) return;
    setHideJobIds((prev) => {
      if (prev.size === 0) return prev;
      const visibleUnbound = new Set<Id<'videoLinkJobs'>>();
      for (const job of queryResult) {
        if (job.messageBoundAt === undefined) visibleUnbound.add(job.jobId);
      }
      let mutated = false;
      const next = new Set<Id<'videoLinkJobs'>>();
      for (const id of prev) {
        if (visibleUnbound.has(id)) next.add(id);
        else mutated = true;
      }
      return mutated ? next : prev;
    });
  }, [queryResult]);

  const jobs = useMemo<VideoLinkJob[]>(() => {
    if (!queryResult) return [];
    return queryResult.filter((job) => {
      if (job.displayStatus === 'skipped') return false;
      if (job.messageBoundAt !== undefined) return false;
      if (job.lifecycleStatus === 'trashed') return false;
      if (hideJobIds.has(job.jobId)) return false;
      return true;
    });
  }, [queryResult, hideJobIds]);

  const isAnyProcessing = useMemo(
    () => jobs.some((job) => NON_TERMINAL.has(job.displayStatus)),
    [jobs],
  );
  const hasFailedJobs = useMemo(
    () => jobs.some((job) => job.displayStatus === 'failed'),
    [jobs],
  );

  const ingestUrlsFromText = useCallback(
    async (text: string): Promise<number> => {
      const matches = extractVideoUrls(text, { maxUrls: 3 });
      let ingested = 0;
      for (const match of matches) {
        try {
          await ingestMutation({
            organizationId: args.organizationId,
            ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
            url: match.url,
            pastedToken: match.pastedToken,
            normalizedUrl: normalizeUrlForHash(match.url),
            sourcePlatform: match.platform,
            userLocale: args.locale,
          });
          ingested += 1;
        } catch (err) {
          const code = convexErrorCode(err);
          toast({
            title: t('videoLink.toast.ingestFailedTitle'),
            description: t(
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
    [args.organizationId, args.threadId, args.locale, ingestMutation, t],
  );

  const cancelJob = useCallback(
    async (jobId: Id<'videoLinkJobs'>) => {
      // Hide first so the ✕ feels instant; reverted if the mutation fails.
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
      try {
        await retryMutation({ jobId });
      } catch (err) {
        // The mutation refuses with structured codes (cooldown, budget,
        // in-flight cap); without this catch the click reads as dead.
        const code = convexErrorCode(err);
        toast({
          title: t('videoLink.toast.retryFailedTitle'),
          description: t(
            code ? `videoLink.errors.${code}` : 'videoLink.errors.generic',
          ),
          variant: 'destructive',
        });
        console.error(
          '[useChatVideoLinks] retry failed:',
          err instanceof Error ? err.message : err,
        );
      }
    },
    [retryMutation, t],
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
