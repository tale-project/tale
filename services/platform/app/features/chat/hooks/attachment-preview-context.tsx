'use client';

/**
 * Local previews for sent images — `fileId → objectURL`.
 *
 * The composer already holds every staged image as an in-memory object URL.
 * When a send consumes the staging, those URLs move into this map instead of
 * being revoked, so the optimistic bubble (and the real row that adopts it)
 * can paint the image INSTANTLY — no waiting for the server URL query, and
 * no thumbnail flash when the real row lands.
 *
 * The map is a single mutable instance provided by the chat surface: its
 * identity never changes (no context re-render storm), and rows read it
 * during their own renders — which always happen after the send populated
 * it. The surface revokes everything on thread switch and unmount.
 */

import { createContext, useContext } from 'react';

const AttachmentPreviewContext = createContext<Map<string, string> | null>(
  null,
);

export const AttachmentPreviewProvider = AttachmentPreviewContext.Provider;

/** The sent-image preview map, or null outside a providing surface (shared
 * views, tests) — callers fall back to the server-resolved URL. */
export function useAttachmentPreviews(): Map<string, string> | null {
  return useContext(AttachmentPreviewContext);
}
