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

// `requestVideoFrameCallback` isn't in the DOM lib types everywhere yet.
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
};

/**
 * Resolve once the video element actually has a decoded frame ready to draw.
 * `play()` resolving only means playback *started* — the first frame may not
 * be painted yet, and drawing too early is what produces a black capture.
 *
 * Prefer `requestVideoFrameCallback` (fires precisely when a frame is
 * presentable). Fall back to the `loadeddata` event plus two animation frames
 * so the frame is committed before we read it. A timeout backstop keeps us
 * from hanging if neither ever fires.
 */
function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const rvfc = (video as VideoWithFrameCallback).requestVideoFrameCallback;
    if (typeof rvfc === 'function') {
      rvfc.call(video, finish);
    } else {
      const onReady = () =>
        requestAnimationFrame(() => requestAnimationFrame(finish));
      if (video.readyState >= 2 /* HAVE_CURRENT_DATA */) {
        onReady();
      } else {
        video.addEventListener('loadeddata', onReady, { once: true });
      }
    }

    // Backstop: never wait forever for a frame callback that doesn't arrive.
    setTimeout(finish, 1000);
  });
}

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
    video.playsInline = true;
    await video.play();
    // Wait for a real decoded frame — drawing before one exists yields a
    // black rectangle.
    await waitForVideoFrame(video);

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
