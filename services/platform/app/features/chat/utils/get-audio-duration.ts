/**
 * Read a media file's duration in seconds without decoding it.
 *
 * Uses a `<video>` element (HTMLMediaElement) for metadata-only loading.
 * Works for both audio and video containers across all modern browsers
 * (mp3/m4a/wav/ogg/webm/mp4/mov/mkv/avi/...) — for audio-only inputs the
 * video element just doesn't render any visual, but duration is still
 * populated.
 *
 * Resolves with the duration, or `null` if the browser couldn't read
 * metadata (corrupt file, unsupported codec). Callers should treat `null`
 * as "length unknown" and either reject the upload or let it through and
 * rely on server-side validation.
 */
export async function getAudioDuration(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number | null>((resolve) => {
      const media = document.createElement('video');
      media.preload = 'metadata';
      media.src = url;
      media.addEventListener('loadedmetadata', () => {
        const d = media.duration;
        resolve(Number.isFinite(d) && d > 0 ? d : null);
      });
      media.addEventListener('error', () => resolve(null));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
