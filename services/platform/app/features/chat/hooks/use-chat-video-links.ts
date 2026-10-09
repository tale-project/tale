'use client';

import { toast } from '@tale/ui/use-toast';
import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { BackendApiError } from '@/app/lib/backend/api-client';
import {
  cancelVideoLinkRequest,
  ingestVideoUrlRequest,
  retryVideoLinkRequest,
  videoJobsForThreadQuery,
  videoJobsUnboundQuery,
} from '@/app/lib/backend/chat';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';
import { VIDEO_LINK_HINT_ENTITY } from '@/lib/shared/hint-entities';
import { extractVideoUrls, findPlaylistUrls } from '@/lib/shared/video-url';

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
 * (`BackendApiError.code`), the legacy path a AppError `data.code`; a
 * video-link refusal's code names its `videoLink.errors.*` key. */
function backendErrorCode(err: unknown): string | undefined {
  if (err instanceof BackendApiError) return err.code;
  return err instanceof AppError &&
    typeof err.data === 'object' &&
    err.data !== null &&
    'code' in err.data
    ? String(err.data.code)
    : undefined;
}

/**
 * What a failed ingest, retry or remove says under its toast's title: the
 * chip's own sentence for a video-link refusal (`videoLink.errors.*`), else
 * the platform's reading of the failure (`failureDetail`: a refusal's own
 * words, a lapsed session, a lost connection), else nothing — a fault, which
 * each caller covers with its own line.
 */
function videoLinkFailureDetail(
  err: unknown,
  t: TFunction,
): string | undefined {
  const code = backendErrorCode(err);
  if (code === 'RATE_LIMITED') {
    const data =
      err instanceof BackendApiError || err instanceof AppError
        ? err.data
        : undefined;
    const retryAfterMs =
      data !== null && typeof data === 'object' && 'retryAfterMs' in data
        ? data.retryAfterMs
        : undefined;
    if (
      typeof retryAfterMs === 'number' &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs > 0 &&
      retryAfterMs <= Number.MAX_SAFE_INTEGER
    ) {
      return t('videoLink.errors.RATE_LIMITED_RETRY', {
        seconds: Math.ceil(retryAfterMs / 1000),
      });
    }
    return t('videoLink.errors.RATE_LIMITED');
  }
  const known =
    code === undefined
      ? ''
      : t(`videoLink.errors.${code}`, { defaultValue: '' });
  return known !== '' ? known : failureDetail(err);
}

/**
 * Retry a failed video job, reporting a refusal the way every video chip
 * does: a destructive toast saying why, and the failed chip left with its
 * Try again. Never rejects. The composer's chips and the queued-send tray
 * retry through it alike.
 */
export async function retryVideoLinkJob(
  organizationId: string,
  jobId: string,
  t: TFunction,
): Promise<void> {
  try {
    await retryVideoLinkRequest(organizationId, jobId);
  } catch (err) {
    // The door refuses with structured codes (cooldown, budget, in-flight
    // cap); without the toast the click reads as dead.
    toast({
      title: t('videoLink.toast.retryFailedTitle'),
      description:
        videoLinkFailureDetail(err, t) ?? t('videoLink.errors.generic'),
      variant: 'destructive',
    });
    console.error(
      '[useChatVideoLinks] retry failed:',
      err instanceof Error ? err.message : err,
    );
  }
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
  /** Remove a chip (cancels its job). Never rejects: a refusal puts the
   * chip back and toasts why, as `retryJob` does for a refused retry. */
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  /** Hide chips synchronously on send-click; the server bind's subscription
   * re-emit lags the round-trip. Pair with `unmarkJobsSent` on rollback. */
  markJobsSent: (jobIds: Array<string>) => void;
  unmarkJobsSent: (jobIds: Array<string>) => void;
}

export function useChatVideoLinks(args: {
  threadId: string | undefined;
  /** A project's new chat, before its thread exists: what a pasted link's
   * transcription costs counts toward the project. */
  projectId?: string;
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

  // The writer's own tab asks at once (the backend's hint lands within a
  // poll tick for everyone else): a paste paints its chip, a retry flips a
  // failed chip back to live so the fallback poll resumes, a cancel settles
  // — none of them wait for a hint that a reconnect gap could swallow.
  const nudgeChips = useCallback(() => {
    void chatQueryClient.invalidateQueries({
      queryKey: backendEntityPrefix(
        args.organizationId,
        VIDEO_LINK_HINT_ENTITY,
      ),
    });
  }, [chatQueryClient, args.organizationId]);

  const ingestUrlsFromText = useCallback(
    async (text: string): Promise<number> => {
      const matches = extractVideoUrls(text, { maxUrls: 3 });
      // A pasted playlist never chips (the extractor skips it), so nothing
      // downstream would ever explain why — say it here, once per paste.
      if (findPlaylistUrls(text).length > 0) {
        toast({
          title: t('videoLink.toast.ingestFailedTitle'),
          description: t('videoLink.errors.playlist'),
          variant: 'destructive',
        });
      }
      let ingested = 0;
      for (const match of matches) {
        try {
          // Dedup key + platform derive SERVER-side on 0.5 (the route owns
          // normalization) — only the pasted facts travel.
          await ingestVideoUrlRequest({
            organizationId: args.organizationId,
            ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
            ...(args.threadId === undefined && args.projectId !== undefined
              ? { projectId: args.projectId }
              : {}),
            url: match.url,
            pastedToken: match.pastedToken,
            userLocale: args.locale,
          });
          ingested += 1;
        } catch (err) {
          toast({
            title: t('videoLink.toast.ingestFailedTitle'),
            description:
              videoLinkFailureDetail(err, t) ?? t('videoLink.errors.generic'),
            variant: 'destructive',
          });
          console.error(
            '[useChatVideoLinks] ingest failed:',
            err instanceof Error ? err.message : err,
          );
          // The shared allowance also refuses the remaining links; say so
          // once and leave those links for a later paste.
          if (backendErrorCode(err) === 'RATE_LIMITED') break;
        }
      }
      if (ingested > 0) nudgeChips();
      return ingested;
    },
    [
      args.organizationId,
      args.threadId,
      args.projectId,
      args.locale,
      t,
      nudgeChips,
    ],
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      // Hide first so the ✕ feels instant; a refusal brings the chip back.
      setHideJobIds((prev) => {
        if (prev.has(jobId)) return prev;
        const next = new Set(prev);
        next.add(jobId);
        return next;
      });
      try {
        await cancelVideoLinkRequest(args.organizationId, jobId);
      } catch (err) {
        if (backendErrorCode(err) === 'notFound') {
          // Nothing left to remove (the unbound-job sweep took it): the chip
          // stays hidden and the read below drops it.
          console.warn('[useChatVideoLinks] cancel found no job:', jobId);
        } else {
          setHideJobIds((prev) => {
            if (!prev.has(jobId)) return prev;
            const next = new Set(prev);
            next.delete(jobId);
            return next;
          });
          // Reported here, as a refused retry is: the caller fires and
          // forgets, and a chip that silently comes back reads as a glitch.
          toast({
            title: t('videoLink.toast.removeFailedTitle'),
            description:
              videoLinkFailureDetail(err, t) ??
              t('videoLink.toast.removeFailedDescription'),
            variant: 'destructive',
          });
          console.error(
            '[useChatVideoLinks] cancel failed:',
            err instanceof Error ? err.message : err,
          );
        }
      }
      // Read the chips again either way: a refused cancel may have met a
      // job that moved on, and a settled chip no longer polls.
      nudgeChips();
    },
    [args.organizationId, t, nudgeChips],
  );

  const retryJob = useCallback(
    async (jobId: string) => {
      await retryVideoLinkJob(args.organizationId, jobId, t);
      nudgeChips();
    },
    [args.organizationId, t, nudgeChips],
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
