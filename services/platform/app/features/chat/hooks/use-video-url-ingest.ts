import { useCallback, useState } from 'react';

/** Matches the composer's `ingestVideoUrlsFromText` prop. */
type IngestVideoUrls = (
  text: string,
  organizationId: string,
  userLocale?: string,
) => Promise<number>;

/**
 * Owns the "a pasted/dropped video URL is being ingested" pending flag that the
 * composer's paste handler and drag-and-drop handler previously each inlined as
 * the same set-pending → call → clear-in-`finally` block.
 *
 * `pending` flips to `true` synchronously BEFORE the ingest awaits so the
 * send-gate observes it on the very next render — a paste/drop-then-Enter race
 * would otherwise ship the message before the ingest round-trip lands and the
 * video-link chip reflects the new row. `ingest` is a no-op when ingestion is
 * unavailable or the text is empty.
 */
export function useVideoUrlIngest(
  ingestVideoUrlsFromText: IngestVideoUrls | undefined,
  organizationId: string,
  userLocale: string,
): { pending: boolean; ingest: (text: string) => void } {
  const [pending, setPending] = useState(false);

  const ingest = useCallback(
    (text: string) => {
      if (!ingestVideoUrlsFromText || !text) return;
      setPending(true);
      void ingestVideoUrlsFromText(text, organizationId, userLocale)
        .catch((err: unknown) => {
          // Best-effort enrichment — a failed ingest must not surface as an
          // unhandled rejection; the message still sends without the chip.
          console.error('[useVideoUrlIngest] video URL ingest failed:', err);
        })
        .finally(() => {
          setPending(false);
        });
    },
    [ingestVideoUrlsFromText, organizationId, userLocale],
  );

  return { pending, ingest };
}
