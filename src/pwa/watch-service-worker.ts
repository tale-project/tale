/** Check long-lived tabs and resume after sleep/network recovery. */
export const SW_UPDATE_INTERVAL_MS = 60_000;

/** Activate the actual waiting worker, including updates on a first-visit tab.
 * Workbox remembers isUpdate at registration time; it stays false for that
 * tab even after the first install controls it, so its reload callback alone
 * cannot complete the next release. */
export function activateWaitingWorker(
  worker: ServiceWorker,
  reload: () => void,
  onFailure: (error: Error) => void = (error) => console.warn(error),
): () => void {
  const container = navigator.serviceWorker;
  const stop = (): void => {
    clearTimeout(timeout);
    container.removeEventListener('controllerchange', controlled);
    worker.removeEventListener('statechange', changed);
  };
  const controlled = (): void => {
    if (container.controller !== worker) return;
    stop();
    reload();
  };
  const changed = (): void => {
    if (worker.state === 'redundant') {
      stop();
      onFailure(new Error('Service worker activation was superseded'));
    }
  };
  container.addEventListener('controllerchange', controlled);
  worker.addEventListener('statechange', changed);
  const timeout = setTimeout(() => {
    stop();
    onFailure(new Error('Service worker activation timed out'));
  }, 15_000);
  try {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- ServiceWorker.postMessage takes transfer options, not a Window targetOrigin.
    worker.postMessage({ type: 'SKIP_WAITING' });
    controlled();
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

export function watchServiceWorker(
  registration: ServiceWorkerRegistration,
  onWaiting: (worker: ServiceWorker) => void,
): () => void {
  let stopped = false;
  let updating = false;
  let installing: ServiceWorker | null = null;
  const checkWaiting = (): void => {
    const worker = registration.waiting;
    // A first install has no active predecessor. Once that install controls
    // the page, subsequent releases are updates even without a page reload.
    // Defer prompts in hidden tabs so a timed toast cannot expire unseen.
    if (
      !stopped &&
      document.visibilityState !== 'hidden' &&
      worker &&
      registration.active &&
      navigator.serviceWorker?.controller
    )
      onWaiting(worker);
  };
  const watchInstalling = (): void => {
    installing?.removeEventListener('statechange', checkWaiting);
    installing = registration.installing;
    installing?.addEventListener('statechange', checkWaiting);
    checkWaiting();
  };
  const update = (): void => {
    checkWaiting();
    if (
      stopped ||
      updating ||
      registration.installing ||
      !navigator.onLine ||
      document.visibilityState === 'hidden'
    )
      return;
    updating = true;
    void registration
      .update()
      .catch((error: unknown) => {
        // An offline proxy or unavailable origin must leave the active worker.
        console.warn('Service worker update check failed', error);
      })
      .finally(() => {
        updating = false;
        checkWaiting();
      });
  };
  const visible = (): void => {
    if (document.visibilityState === 'visible') update();
  };
  const interval = setInterval(update, SW_UPDATE_INTERVAL_MS);
  registration.addEventListener('updatefound', watchInstalling);
  window.addEventListener('online', update);
  window.addEventListener('focus', update);
  document.addEventListener('visibilitychange', visible);
  watchInstalling();
  return () => {
    stopped = true;
    clearInterval(interval);
    installing?.removeEventListener('statechange', checkWaiting);
    registration.removeEventListener('updatefound', watchInstalling);
    window.removeEventListener('online', update);
    window.removeEventListener('focus', update);
    document.removeEventListener('visibilitychange', visible);
  };
}
