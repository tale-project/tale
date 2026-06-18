/**
 * Shallow structural equality for the message fields that drive rendering.
 *
 * Extracted so the bubble's memo comparator (message-bubble.tsx) AND the
 * message-list per-message identity hold (use-message-processing.ts) compare on
 * the SAME canonical "did anything renderable change?" predicate — the two must
 * never drift, or the list would hold a stale reference the bubble considers
 * changed (or vice versa).
 *
 * Typed against the minimal field shapes actually read, not against either
 * `ChatMessage` or the bubble's `Message`, so both satisfy it structurally
 * without coupling this util to either declaration.
 */

interface AttachmentFields {
  fileId: string;
  fileType: string;
  previewUrl?: string;
  fileName: string;
}

interface FilePartFields {
  url: string;
  mediaType: string;
  filename?: string;
}

export function sameAttachments(
  a: readonly AttachmentFields[] | undefined,
  b: readonly AttachmentFields[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].fileId !== b[i].fileId ||
      a[i].fileType !== b[i].fileType ||
      a[i].previewUrl !== b[i].previewUrl ||
      a[i].fileName !== b[i].fileName
    )
      return false;
  }
  return true;
}

export function sameFileParts(
  a: readonly FilePartFields[] | undefined,
  b: readonly FilePartFields[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].url !== b[i].url ||
      a[i].mediaType !== b[i].mediaType ||
      a[i].filename !== b[i].filename
    )
      return false;
  }
  return true;
}

function isPartRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Structural compare of UIMessage parts for the thought-process timeline. The
 * message list rebuilds `parts` with fresh references on every streamed token,
 * so a reference check would never re-render — but a deep check would re-render
 * every bubble per tick. Compare length + per-part identity (type, state,
 * toolCallId, text length): enough to catch reasoning growth and tool-state
 * transitions without churning unrelated bubbles.
 */
export function sameParts(
  a: readonly unknown[] | undefined,
  b: readonly unknown[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i];
    const pb = b[i];
    if (!isPartRecord(pa) || !isPartRecord(pb)) {
      if (pa !== pb) return false;
      continue;
    }
    if (pa.type !== pb.type) return false;
    if (pa.state !== pb.state) return false;
    if (pa.toolCallId !== pb.toolCallId) return false;
    const ta = typeof pa.text === 'string' ? pa.text.length : 0;
    const tb = typeof pb.text === 'string' ? pb.text.length : 0;
    if (ta !== tb) return false;
  }
  return true;
}
