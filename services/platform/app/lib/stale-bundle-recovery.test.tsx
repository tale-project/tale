// @vitest-environment jsdom
/**
 * A tab that outlived a deploy: the first failed load of a chunk reloads the
 * page onto the new build, once; the same chunk failing again at the same
 * `TALE_VERSION` asks with a toast instead of reloading in a loop. Each case
 * dispatches the synthetic `vite:preloadError` Vite's preload helper raises,
 * and a "page" is one install of the handler — a reload uninstalls it and
 * installs a fresh one over the same sessionStorage, as the browser would.
 */

import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeBackend } from '@/app/lib/backend/connection-state';
import { checkAccessibility } from '@/tests/utils/a11y';
import { act, cleanup, render, within } from '@/tests/utils/render';

import {
  installStaleBundleRecovery,
  isStaleBundleFallout,
} from './stale-bundle-recovery';

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

/** What the page knows about its deployment, and what a probe would find. */
const deployment = vi.hoisted(() => ({ known: true, answers: true }));
vi.mock('@/app/lib/backend/connection-state', () => ({
  isBackendReachable: () => deployment.known,
  probeBackend: vi.fn(() => Promise.resolve(deployment.answers)),
}));

// jsdom has no pointer capture, and the toast's swipe handling asks for it on
// every click — stubbed as the ui project's setup (tests/setup-ui.ts) does.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

const VERSION = '1.8.0';
const CHUNK = 'https://tale.example/assets/document-preview-pdf-C4h9kQ2x.js';
const OTHER_CHUNK =
  'https://tale.example/assets/document-preview-docx-Pq81mZ0a.js';

function chunkFailure(url = CHUNK): TypeError {
  return new TypeError(`Failed to fetch dynamically imported module: ${url}`);
}

/**
 * What Vite's preload helper dispatches when a lazy import fails, plus the
 * deployment probe the handler awaits before it reloads or asks.
 */
async function dispatchPreloadError(payload: unknown) {
  const event = Object.assign(
    new Event('vite:preloadError', { cancelable: true }),
    { payload },
  );
  await act(async () => {
    window.dispatchEvent(event);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
  return event;
}

let uninstallPage: (() => void) | undefined;

/** Loads a page at `version`; the returned mock is that page's reload. */
function loadPage(version = VERSION) {
  uninstallPage?.();
  window.__ENV__ = { TALE_VERSION: version };
  const reload = vi.fn();
  uninstallPage = installStaleBundleRecovery({ reload });
  return reload;
}

function toastViewport(): HTMLElement {
  const viewport = document.body.querySelector('ol');
  if (!(viewport instanceof HTMLElement)) throw new Error('no toast viewport');
  return viewport;
}

describe('installStaleBundleRecovery', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    deployment.known = true;
    deployment.answers = true;
    render(<Toaster />);
  });

  afterEach(() => {
    uninstallPage?.();
    uninstallPage = undefined;
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(toast).mockClear();
    vi.mocked(probeBackend).mockClear();
    delete window.__ENV__;
  });

  it('reloads once, then asks with a toast instead of looping', async () => {
    const firstReload = loadPage();
    const first = await dispatchPreloadError(chunkFailure());
    expect(first.defaultPrevented).toBe(true);
    expect(firstReload).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();

    // The reload came back on the same build — mid-rollout, or the chunk is
    // really gone — and the chunk fails again.
    const secondReload = loadPage();
    const second = await dispatchPreloadError(chunkFailure());
    expect(secondReload).not.toHaveBeenCalled();
    // Not prevented: the caller fails on the real error, not on `undefined`.
    expect(second.defaultPrevented).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        duration: Infinity,
        title: 'A new version is available',
      }),
    );
    expect(toastViewport().textContent).toContain('A new version is available');

    const thirdReload = loadPage();
    await dispatchPreloadError(chunkFailure());
    expect(thirdReload).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('keys the attempt by the page version and the chunk URL', async () => {
    loadPage();
    await dispatchPreloadError(chunkFailure());
    expect(
      window.sessionStorage.getItem(
        `tale:stale-bundle-reload:${VERSION}:${CHUNK}`,
      ),
    ).toBe('1');

    // Another chunk at the same version gets its own reload…
    const otherChunkReload = loadPage();
    await dispatchPreloadError(chunkFailure(OTHER_CHUNK));
    expect(otherChunkReload).toHaveBeenCalledTimes(1);

    // …and so does the same chunk once the tab runs the next version.
    const nextVersionReload = loadPage('1.9.0');
    await dispatchPreloadError(chunkFailure());
    expect(nextVersionReload).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('answers nothing more while the page is on its way out', async () => {
    const reload = loadPage();
    await dispatchPreloadError(chunkFailure());
    const onTheWayOut = await dispatchPreloadError(chunkFailure(OTHER_CHUNK));
    expect(onTheWayOut.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('asks with the toast when the page stays, and does not ask it to leave again', async () => {
    vi.useFakeTimers();
    const reload = loadPage();
    await dispatchPreloadError(chunkFailure());
    expect(reload).toHaveBeenCalledTimes(1);

    // An unsaved editor's leave prompt was answered with Stay.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(toast).toHaveBeenCalledTimes(1);

    const afterStaying = await dispatchPreloadError(chunkFailure(OTHER_CHUNK));
    expect(afterStaying.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('does not spend the reload on an outage the probe finds', async () => {
    // The server went away mid-deploy: the chunk fetch and the probe both
    // get no answer. A reload now would land on the browser's error page.
    deployment.answers = false;
    const duringOutage = loadPage();
    const event = await dispatchPreloadError(chunkFailure());
    expect(probeBackend).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(duringOutage).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(window.sessionStorage).toHaveLength(0);
    // Its caller still got `undefined`: what it throws is not reported.
    expect(isStaleBundleFallout()).toBe(true);

    // Back up, still on the previous build: the next failure gets its reload.
    deployment.answers = true;
    await dispatchPreloadError(chunkFailure());
    expect(duringOutage).toHaveBeenCalledTimes(1);
  });

  it('asks the deployment afresh while the page still thinks it is away', async () => {
    // The deploy restarted the server: the page's background requests failed
    // and its verdict still reads "unreachable" when the chunk misses, a
    // moment after the new build came up. Only the probe knows it is back.
    deployment.known = false;
    const reload = loadPage();
    const event = await dispatchPreloadError(chunkFailure());
    expect(event.defaultPrevented).toBe(true);
    expect(probeBackend).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not claim a new version while the deployment does not answer', async () => {
    loadPage();
    await dispatchPreloadError(chunkFailure());
    deployment.answers = false;
    const reload = loadPage();
    await dispatchPreloadError(chunkFailure());
    expect(reload).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps what a swallowed failure leaves behind from the error reporter', async () => {
    vi.useFakeTimers();
    loadPage();
    expect(isStaleBundleFallout()).toBe(false);
    await dispatchPreloadError(chunkFailure());
    // The prevented import resolved `undefined`; its caller's TypeError while
    // the page reloads is the recovery's own.
    expect(isStaleBundleFallout()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(isStaleBundleFallout()).toBe(false);
  });

  it('still reports a chunk that fails again after its reload', async () => {
    loadPage();
    await dispatchPreloadError(chunkFailure());
    loadPage();
    expect(isStaleBundleFallout()).toBe(false);
    const again = await dispatchPreloadError(chunkFailure());
    expect(again.defaultPrevented).toBe(false);
    expect(isStaleBundleFallout()).toBe(false);
  });

  it.each([
    [
      'WebKit, whose message names no chunk',
      'Importing a module script failed.',
    ],
    ['Firefox', `error loading dynamically imported module: ${CHUNK}`],
    [
      'a stylesheet of the chunk',
      'Unable to preload CSS for https://tale.example/assets/document-preview-pdf-D0c5sX1a.css',
    ],
  ])('treats a failure from %s the same way', async (_source, message) => {
    const firstReload = loadPage();
    await dispatchPreloadError(new TypeError(message));
    expect(firstReload).toHaveBeenCalledTimes(1);

    const secondReload = loadPage();
    await dispatchPreloadError(new TypeError(message));
    expect(secondReload).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('leaves a chunk that loaded and then threw to its caller', async () => {
    const reload = loadPage();
    const event = await dispatchPreloadError(
      new ReferenceError('pdfjsLib is not defined'),
    );
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it('leaves a failure while offline to the offline gate', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const reload = loadPage();
    const event = await dispatchPreloadError(chunkFailure());
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it('asks instead of reloading when it cannot remember the attempt', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException(
        'The quota has been exceeded.',
        'QuotaExceededError',
      );
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reload = loadPage();
    const event = await dispatchPreloadError(chunkFailure());
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reloads from the toast, and Later puts it away', async () => {
    const user = userEvent.setup();
    loadPage();
    await dispatchPreloadError(chunkFailure());
    const reload = loadPage();
    await dispatchPreloadError(chunkFailure());

    await checkAccessibility(document.body);
    await user.click(
      within(toastViewport()).getByRole('button', { name: 'Reload' }),
    );
    expect(reload).toHaveBeenCalledTimes(1);

    await dispatchPreloadError(chunkFailure());
    await user.click(
      within(toastViewport()).getByRole('button', { name: 'Later' }),
    );
    expect(
      within(toastViewport()).queryByRole('button', { name: 'Later' }),
    ).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
