'use client';

import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { BackendApiError } from '@/app/lib/backend/api-client';
import {
  cancelVideoLinkRequest,
  ingestVideoUrlRequest,
  retryVideoLinkRequest,
  videoJobsForThreadQuery,
  videoJobsUnboundQuery,
} from '@/app/lib/backend/chat';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';
import { extractVideoUrls } from '@/lib/shared/video-url';

import { useChatQueryClient } from '../data/chat-backend';

/**
 * Reactive subscription on this conversation's video-link jobs + ingest /
 * cancel / retry callbacks — the 0.3 chat hook against the `video_links`
 * backend that survived the rewrite intact. The chip UI consumes `jobs`;
 * the send path watches `isAnyProcessing` (deferred send) and
 * `hasFailedJobs` (send stays blocked until the user retries or removes).
 */
export interface VideoLinkJob {
  jobId: string;
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

/** Structured `code` off a refusal — the 0.5 backend answers coded JSON
 * (`BackendApiError.code`), the legacy path a AppError `data.code`;
 * both map 1:1 to `videoLink.errors.*` keys. */
function backendErrorCode(err: unknown): string | undefined {
  if (err instanceof BackendApiError) return err.code;
  return err instanceof AppError &&
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
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  /** Hide chips synchronously on send-click; the server bind's subscription
   * re-emit lags the round-trip. Pair with `unmarkJobsSent` on rollback. */
  markJobsSent: (jobIds: Array<string>) => void;
  unmarkJobsSent: (jobIds: Array<string>) => void;
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
  const chatQueryClient = useChatQueryClient();
  const threadResult = useTanstackQuery(
    {
      ...videoJobsForThreadQuery(args.organizationId, args.threadId ?? ''),
      enabled: args.threadId !== undefined,
    },
    chatQueryClient,
  );
  const unboundResult = useTanstackQuery(
    {
      ...videoJobsUnboundQuery(args.organizationId),
      enabled: args.threadId === undefined,
    },
    chatQueryClient,
  );
  const queryResult =
    args.threadId !== undefined ? threadResult.data : unboundResult.data;

  // Client-side "just-sent" set so chips vanish in the same commit as the
  // composer clearing; pruned once the subscription catches up.
  const [hideJobIds, setHideJobIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const markJobsSent = useCallback((jobIds: Array<string>) => {
    if (jobIds.length === 0) return;
    setHideJobIds((prev) => {
      const next = new Set(prev);
      for (const id of jobIds) next.add(id);
      return next;
    });
  }, []);

  const unmarkJobsSent = useCallback((jobIds: Array<string>) => {
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
      const visibleUnbound = new Set<string>();
      for (const job of queryResult) {
        if (job.messageBoundAt === undefined) visibleUnbound.add(job.jobId);
      }
      let mutated = false;
      const next = new Set<string>();
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
          // Dedup key + platform derive SERVER-side on 0.5 (the route owns
          // normalization) — only the pasted facts travel.
          await ingestVideoUrlRequest({
            organizationId: args.organizationId,
            ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
            url: match.url,
            pastedToken: match.pastedToken,
            userLocale: args.locale,
          });
          ingested += 1;
        } catch (err) {
          const code = backendErrorCode(err);
          toast({
            title: t('videoLink.toast.ingestFailedTitle'),
            // defaultValue: an unmapped backend code degrades to the generic
            // copy instead of rendering a raw i18n key (the chip's pattern).
            description: code
              ? t(`videoLink.errors.${code}`, {
                  defaultValue: t('videoLink.errors.generic'),
                })
              : t('videoLink.errors.generic'),
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
    [args.organizationId, args.threadId, args.locale, t],
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      // Hide first so the ✕ feels instant; reverted if the mutation fails.
      setHideJobIds((prev) => {
        if (prev.has(jobId)) return prev;
        const next = new Set(prev);
        next.add(jobId);
        return next;
      });
      try {
        await cancelVideoLinkRequest(args.organizationId, jobId);
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
    [args.organizationId],
  );

  const retryJob = useCallback(
    async (jobId: string) => {
      try {
        await retryVideoLinkRequest(args.organizationId, jobId);
      } catch (err) {
        // The mutation refuses with structured codes (cooldown, budget,
        // in-flight cap); without this catch the click reads as dead.
        const code = backendErrorCode(err);
        toast({
          title: t('videoLink.toast.retryFailedTitle'),
          // defaultValue: an unmapped backend code degrades to the generic
          // copy instead of rendering a raw i18n key (the chip's pattern).
          description: code
            ? t(`videoLink.errors.${code}`, {
                defaultValue: t('videoLink.errors.generic'),
              })
            : t('videoLink.errors.generic'),
          variant: 'destructive',
        });
        console.error(
          '[useChatVideoLinks] retry failed:',
          err instanceof Error ? err.message : err,
        );
      }
    },
    [args.organizationId, t],
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
