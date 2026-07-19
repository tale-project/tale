'use client';

import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { FileText } from 'lucide-react';
import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { useChatVideoLinks } from '../hooks/use-chat-video-links';
import type { FileAttachment } from '../hooks/use-convex-file-upload';
import { useFileIndexingStatus } from '../hooks/use-file-indexing-status';
import { useFileTranscriptionStatus } from '../hooks/use-file-transcription-status';
import { AttachmentStatusLabel } from './chat-input/attachment-status-label';
import { VideoLinkChip } from './video-link-chip';

export interface WaitingMediaAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/**
 * The live progress strip under a `waiting_media` queue-tray row — the same
 * detail the composer showed before the send, so parking the message never
 * loses "Fetching captions…" / "Transcribing…" / indexing state or the
 * retry affordance.
 *
 * Video jobs render the REAL `VideoLinkChip` in its flat form (matched from
 * the thread's job subscription by the row's claimed ids — the composer
 * hook filters bound rows out, so this reads the raw query). The row's ✕ is
 * the only cancel and it cancels the media processing too
 * (`cancelDeferredJobs`). File attachments reuse the composer's
 * status-label with the same indexing/transcription subscriptions.
 */
export function WaitingMediaDetails({
  threadId,
  organizationId,
  attachments,
  videoJobIds,
}: {
  threadId: string;
  organizationId: string;
  attachments?: readonly WaitingMediaAttachment[];
  videoJobIds?: readonly Id<'videoLinkJobs'>[];
}) {
  const { data: jobRows } = useConvexQuery(
    api.video_links.queries.listForThread,
    videoJobIds && videoJobIds.length > 0
      ? { threadId, organizationId }
      : 'skip',
  );
  // Callback only — the hook's own `jobs` list filters bound rows, which is
  // exactly what these rows are. Convex dedupes the doubled subscription.
  const { retryJob } = useChatVideoLinks({
    threadId,
    organizationId,
  });

  const jobs = useMemo(() => {
    if (!jobRows || !videoJobIds || videoJobIds.length === 0) return [];
    const wanted = new Set<string>(videoJobIds);
    // A cancelled (skipped) job is excluded from the send at start — its
    // chip retires from the strip the same moment.
    return jobRows.filter(
      (j) => wanted.has(j.jobId) && j.displayStatus !== 'skipped',
    );
  }, [jobRows, videoJobIds]);

  // Reconstruct FileAttachment objects rather than asserting the row shape —
  // the queue only stores the four fields the status hooks need, and a cast
  // trips `no-unsafe-type-assertion` (FileAttachment is narrower via optionals).
  const fileAttachments = useMemo(
    (): FileAttachment[] =>
      (attachments ?? [])
        .filter((a) => !a.fileType.startsWith('image/'))
        .map((a) => ({
          fileId: a.fileId,
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        })),
    [attachments],
  );
  const { statusMap: indexingStatuses } = useFileIndexingStatus(
    fileAttachments,
    organizationId,
  );
  const { statusMap: transcriptionStatuses } = useFileTranscriptionStatus(
    fileAttachments,
    organizationId,
  );

  if (jobs.length === 0 && fileAttachments.length === 0) return null;

  // Everything renders FLAT — the tray row is the card; a second border
  // inside it reads as clutter (card-in-card). The row's ✕ is the single
  // cancel affordance and it cancels the media processing too, so chips
  // carry no onCancel; retry stays because it acts on the failed job in
  // place.
  return (
    <HStack gap={3} align="center" className="min-w-0 flex-wrap pl-5">
      {jobs.map((job) => (
        <VideoLinkChip
          key={job.jobId}
          job={job}
          flat
          onRetry={() => void retryJob(job.jobId)}
        />
      ))}
      {fileAttachments.map((attachment) => (
        <HStack
          key={attachment.fileId}
          gap={2}
          align="center"
          className="min-w-0"
        >
          <FileText
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden="true"
          />
          <Text as="span" variant="caption" className="max-w-40 truncate">
            {attachment.fileName}
          </Text>
          <AttachmentStatusLabel
            attachment={attachment}
            indexingStatuses={indexingStatuses}
            transcriptionStatuses={transcriptionStatuses}
          />
        </HStack>
      ))}
    </HStack>
  );
}
