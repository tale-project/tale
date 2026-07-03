// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock('@radix-ui/react-toast', () => ({
  Action: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mockMarkSeen = vi.fn();
const mockMarkToasted = vi.fn();
const notification = {
  shouldShowToast: false,
  needsBaseline: false,
  currentVersion: 'v0.2.97' as string | undefined,
  lastSeenVersion: undefined as string | undefined,
  markSeen: mockMarkSeen,
  markToasted: mockMarkToasted,
};

vi.mock('@/app/hooks/use-changelog-notification', () => ({
  useChangelogNotification: () => ({ ...notification }),
}));

import { ChangelogToastTrigger } from './changelog-toast-trigger';

describe('ChangelogToastTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notification.shouldShowToast = false;
    notification.needsBaseline = false;
    notification.currentVersion = 'v0.2.97';
    notification.lastSeenVersion = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('seeds the baseline silently on a fresh install instead of toasting', () => {
    notification.needsBaseline = true;

    render(<ChangelogToastTrigger />);

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkToasted).not.toHaveBeenCalled();
  });

  it('toasts once and records it when an update was installed', () => {
    notification.shouldShowToast = true;
    notification.lastSeenVersion = 'v0.2.96';

    render(<ChangelogToastTrigger />);

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'changelog.toast.title' }),
    );
    expect(mockMarkToasted).toHaveBeenCalledTimes(1);
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  it('does nothing while the notification state is unresolved', () => {
    render(<ChangelogToastTrigger />);

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockMarkSeen).not.toHaveBeenCalled();
    expect(mockMarkToasted).not.toHaveBeenCalled();
  });

  it('does nothing without a current version', () => {
    notification.needsBaseline = true;
    notification.currentVersion = undefined;

    render(<ChangelogToastTrigger />);

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });
});
