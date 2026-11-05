import { useRef, useState } from 'react';

import { FILE_LINK_LIFETIME_SEC } from '@/lib/shared/constants/file-links';

/** One link of a batch (`files/queries:getFileUrls`). */
interface FileLink {
  fileId: string;
  url: string | null;
}

/** What the renewal reads of a `useFileUrls` result. */
interface FileLinks {
  data?: readonly FileLink[] | undefined;
  refetch: (options: {
    cancelRefetch: boolean;
  }) => Promise<{ data?: readonly FileLink[] | undefined }>;
}

/** What a surface shows for a link: its picture, a placeholder while a new
 * link is on its way, or the file's card or chip once no new link draws. */
export type FileLinkView = 'picture' | 'renewing' | 'file';

const LINK_LIFETIME_MS = FILE_LINK_LIFETIME_SEC * 1000;

/**
 * A picture whose presigned link no longer loads gets a new link before it
 * falls back to its file. A link runs out after `FILE_LINK_LIFETIME_SEC`,
 * and the store answers it with 403 from then on. The batch renews its links
 * before that when the page is looked at again, but a page that stays in
 * view keeps them, and a cached batch can hand out a link that has run out.
 *
 * - `pictureFailed(src)`: the surface's own picture did not draw. It shows
 *   as `renewing` until the batch answers again; a new link draws, the same
 *   link or a failed fetch shows the file.
 * - `previewFailed(src)`: the preview's picture did not draw. The batch is
 *   fetched again; the surface's picture stays as it is.
 *
 * A file gets one renewal per link lifetime: a renewed link that fails
 * before it could run out failed for another reason (bytes that do not
 * decode, a deleted object), so its picture shows the file. So does a src
 * that is no current link of the batch (a local preview).
 */
export function useFileLinkRenewal(links: FileLinks) {
  // The last renewal of each file: the link that failed, and when.
  const renewals = useRef(new Map<string, { from: string; at: number }>());
  // The links a renewal does not help.
  const [final, setFinal] = useState<ReadonlySet<string>>(() => new Set());
  // The links whose picture on the surface did not draw.
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());

  const markFinal = (src: string) =>
    setFinal((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));

  const renew = (src: string) => {
    if (final.has(src)) return;
    const fileId = links.data?.find((row) => row.url === src)?.fileId;
    if (fileId === undefined) {
      markFinal(src);
      return;
    }
    const last = renewals.current.get(fileId);
    // This link's renewal is on its way already.
    if (last?.from === src) return;
    if (last !== undefined && Date.now() - last.at < LINK_LIFETIME_MS) {
      markFinal(src);
      return;
    }
    renewals.current.set(fileId, { from: src, at: Date.now() });
    // Joins a fetch already on its way (a mount's, a focus's, another
    // picture's renewal) instead of cancelling it.
    links.refetch({ cancelRefetch: false }).then(
      (result) => {
        const renewed = result.data?.find((row) => row.fileId === fileId);
        if (renewed?.url === src) markFinal(src);
      },
      (error: unknown) => {
        console.warn('[file-links] renewing a file link failed', error);
        markFinal(src);
      },
    );
  };

  return {
    shows: (src: string): FileLinkView =>
      !held.has(src) ? 'picture' : final.has(src) ? 'file' : 'renewing',
    pictureFailed: (src: string) => {
      setHeld((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));
      renew(src);
    },
    previewFailed: renew,
  };
}
