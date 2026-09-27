/**
 * The update prompt means "a newer version is waiting behind the one you are
 * using". A page nothing controls yet — a first visit — has no version to
 * update from, so the waiting worker a first visit can still observe must
 * not be announced as an update (2026-09-26 evaluation, G-01).
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registration = vi.hoisted(() => ({
  needRefresh: false,
  offlineReady: false,
  onRegisterError: undefined as ((error: unknown) => void) | undefined,
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: { onRegisterError?: (error: unknown) => void }) => {
    registration.onRegisterError = options?.onRegisterError;
    return {
      needRefresh: [registration.needRefresh, vi.fn()],
      offlineReady: [registration.offlineReady, vi.fn()],
      updateServiceWorker: vi.fn(),
    };
  },
}));

import { SwUpdateListener } from './sw-update-listener';

const labels = {
  updateAvailableTitle: 'Update available',
  updateAvailableDescription: 'A new version is ready.',
  updateNow: 'Update now',
  updateLater: 'Later',
  offlineReady: 'Ready offline',
};

function setController(controller: object | null) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller },
  });
}

describe('SwUpdateListener', () => {
  beforeEach(() => {
    registration.needRefresh = true;
    registration.offlineReady = false;
  });
  afterEach(() => {
    cleanup();
    setController(null);
    vi.restoreAllMocks();
  });

  it('prompts for the update when a worker already controls the page', () => {
    setController({});
    const renderUpdateToast = vi.fn();
    render(
      <SwUpdateListener
        labels={labels}
        renderUpdateToast={renderUpdateToast}
        renderOfflineReadyToast={vi.fn()}
      />,
    );
    expect(renderUpdateToast).toHaveBeenCalledTimes(1);
    expect(renderUpdateToast.mock.calls[0]?.[0]).toMatchObject({ labels });
  });

  it('stays quiet on a first install — nothing controls the page, so there is nothing to update from', () => {
    setController(null);
    const renderUpdateToast = vi.fn();
    render(
      <SwUpdateListener
        labels={labels}
        renderUpdateToast={renderUpdateToast}
        renderOfflineReadyToast={vi.fn()}
      />,
    );
    expect(renderUpdateToast).not.toHaveBeenCalled();
  });

  it('announces the offline shell once it is cached', () => {
    registration.needRefresh = false;
    registration.offlineReady = true;
    const renderOfflineReadyToast = vi.fn();
    render(
      <SwUpdateListener
        labels={labels}
        renderUpdateToast={vi.fn()}
        renderOfflineReadyToast={renderOfflineReadyToast}
      />,
    );
    expect(renderOfflineReadyToast).toHaveBeenCalledTimes(1);
  });

  it('logs a refused registration as a warning, never as an error', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errored = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <SwUpdateListener
        labels={labels}
        renderUpdateToast={vi.fn()}
        renderOfflineReadyToast={vi.fn()}
      />,
    );
    const refusal = new DOMException('The operation is insecure.');
    expect(registration.onRegisterError).toBeDefined();
    registration.onRegisterError?.(refusal);
    expect(warned).toHaveBeenCalledWith(
      'Service worker registration failed',
      refusal,
    );
    expect(errored).not.toHaveBeenCalled();
  });
});
