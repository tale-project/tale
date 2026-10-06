import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activateWaitingWorker,
  SW_UPDATE_INTERVAL_MS,
  watchServiceWorker,
} from './watch-service-worker';

let stop: (() => void) | undefined;
function registration() {
  return Object.assign(new EventTarget(), {
    active: new EventTarget(),
    waiting: null as EventTarget | null,
    installing: null as EventTarget | null,
    update: vi.fn().mockResolvedValue(undefined),
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: {} },
  });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('long-lived service worker registration', () => {
  it('makes a timed-out activation retryable and removes its listeners', async () => {
    const container = Object.assign(new EventTarget(), { controller: {} });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container,
    });
    const worker = Object.assign(new EventTarget(), {
      postMessage: vi.fn(),
      state: 'installed',
    });
    const reload = vi.fn();
    const failed = vi.fn();
    stop = activateWaitingWorker(
      worker as unknown as ServiceWorker,
      reload,
      failed,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0]?.[0].message).toContain('timed out');
    container.controller = worker;
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads only after the chosen worker takes control, and only once', () => {
    const container = Object.assign(new EventTarget(), { controller: {} });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: container,
    });
    const worker = Object.assign(new EventTarget(), {
      postMessage: vi.fn(),
      state: 'installed',
    });
    const reload = vi.fn();
    stop = activateWaitingWorker(worker as unknown as ServiceWorker, reload);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    container.controller = worker;
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks periodically and after sleep or network recovery, then cleans up', async () => {
    const native = registration();
    stop = watchServiceWorker(
      native as unknown as ServiceWorkerRegistration,
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(SW_UPDATE_INTERVAL_MS);
    expect(native.update).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.update).toHaveBeenCalledTimes(4);
    stop();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(SW_UPDATE_INTERVAL_MS * 2);
    expect(native.update).toHaveBeenCalledTimes(4);
  });

  it('announces a waiting release discovered on the same page as the first install', () => {
    const native = registration();
    const waiting = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: null },
    });
    stop = watchServiceWorker(
      native as unknown as ServiceWorkerRegistration,
      waiting,
    );
    const worker = new EventTarget();
    native.installing = worker;
    native.dispatchEvent(new Event('updatefound'));
    native.waiting = worker;
    worker.dispatchEvent(new Event('statechange'));
    expect(waiting).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: {} },
    });
    worker.dispatchEvent(new Event('statechange'));
    expect(waiting).toHaveBeenCalledWith(worker);
  });

  it('defers a waiting update prompt until its hidden tab becomes visible', async () => {
    const native = registration();
    const waiting = vi.fn();
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    native.waiting = new EventTarget();
    stop = watchServiceWorker(
      native as unknown as ServiceWorkerRegistration,
      waiting,
    );
    native.dispatchEvent(new Event('updatefound'));
    await vi.advanceTimersByTimeAsync(SW_UPDATE_INTERVAL_MS);
    expect(waiting).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting).toHaveBeenCalledWith(native.waiting);
  });

  it('does not pile up updates or probe a hidden/offline tab', async () => {
    const native = registration();
    native.update.mockReturnValue(new Promise(() => {}));
    stop = watchServiceWorker(
      native as unknown as ServiceWorkerRegistration,
      vi.fn(),
    );
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(SW_UPDATE_INTERVAL_MS);
    expect(native.update).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(SW_UPDATE_INTERVAL_MS);
    expect(native.update).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(SW_UPDATE_INTERVAL_MS * 3);
    expect(native.update).toHaveBeenCalledTimes(1);
  });
});
