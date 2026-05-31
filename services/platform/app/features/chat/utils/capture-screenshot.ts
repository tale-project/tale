/**
 * Capture a screenshot via the Screen Capture API and return it as a PNG
 * `File` ready to feed into the chat upload pipeline. The browser shows its
 * native screen/window/tab picker (and permission prompt); the stream is
 * torn down immediately after a single frame is grabbed.
 *
 * Returns `null` when the API is unavailable. Throws on permission denial /
 * user cancellation (`NotAllowedError` / `AbortError`) — callers should
 * treat those as a silent no-op.
 */
export async function captureScreenshot(): Promise<File | null> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getDisplayMedia
  ) {
    return null;
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // One rAF lets the first frame paint into the element before we draw it.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    video.pause();
    video.srcObject = null;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) return null;

    return new File([blob], `screenshot-${Date.now()}.png`, {
      type: 'image/png',
    });
  } finally {
    // Always release the capture so the browser's "sharing your screen"
    // indicator clears immediately.
    for (const track of stream.getTracks()) track.stop();
  }
}
