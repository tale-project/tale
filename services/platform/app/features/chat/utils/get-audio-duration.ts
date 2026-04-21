/**
 * Read an audio file's duration in seconds without decoding it.
 *
 * Uses `<audio>` element metadata loading — fast (milliseconds), zero
 * dependencies, works in all modern browsers for mp3/m4a/mp4/wav/ogg/webm.
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
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = url;
      audio.addEventListener('loadedmetadata', () => {
        const d = audio.duration;
        resolve(Number.isFinite(d) && d > 0 ? d : null);
      });
      audio.addEventListener('error', () => resolve(null));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
