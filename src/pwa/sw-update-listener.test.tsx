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
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [registration.needRefresh, vi.fn()],
    offlineReady: [registration.offlineReady, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
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
});
