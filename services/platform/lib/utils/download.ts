/**
 * Browser "Save as" helpers shared by the canvas file viewers.
 *
 * Two sources of bytes: text we already hold in memory (a code/markdown/svg file
 * the agent generated) and a remote URL (an image or oversized attachment in
 * Convex storage). Both funnel through a same-origin object URL so the browser
 * honors the workspace filename — a plain `<a download>` is ignored cross-origin
 * and would save under the storage UUID instead.
 */

function triggerDownload(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Save in-memory text as a file named `filename`. */
export function downloadTextFile(filename: string, content: string): void {
  const blobUrl = URL.createObjectURL(
    new Blob([content], { type: 'text/plain;charset=utf-8' }),
  );
  try {
    triggerDownload(blobUrl, filename);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Save an in-memory Blob (e.g. a generated zip) under `filename`. */
function downloadBlobFile(filename: string, blob: Blob): void {
  const blobUrl = URL.createObjectURL(blob);
  try {
    triggerDownload(blobUrl, filename);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Decode a base64 payload (e.g. a `.zip` returned by a Convex export action)
 * and save it under `filename`. Decodes into a fresh `ArrayBuffer`-backed
 * `Uint8Array` so the resulting bytes are a valid `BlobPart`.
 */
export function downloadBase64File(
  filename: string,
  base64: string,
  mimeType = 'application/octet-stream',
): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  downloadBlobFile(filename, new Blob([bytes], { type: mimeType }));
}

/**
 * Fetch a (possibly cross-origin) URL as a Blob and save it under `filename`.
 * Throws on a non-OK response so callers can surface the failure.
 */
export async function downloadUrlFile(
  filename: string,
  url: string,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blobUrl = URL.createObjectURL(await res.blob());
  try {
    triggerDownload(blobUrl, filename);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
