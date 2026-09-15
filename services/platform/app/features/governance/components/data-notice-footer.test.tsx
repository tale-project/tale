import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { dataNoticeBootKey } from '../lib/data-notice-boot';
import { DataNoticeFooter } from './data-notice-footer';

// Drives the mocked `useBackendQuery` return. `undefined` data models a read
// that is loading, skipped, or failed; `null` models a resolved read with no
// stored policy file; an object models a resolved policy.
const { state } = vi.hoisted(() => ({
  state: { data: undefined as unknown },
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: state.data }),
}));

const BOOT_KEY = dataNoticeBootKey('org-1');
const DEFAULT_TEXT =
  'AI can make mistakes—verify responses and do not share sensitive data.';

function noticeEl() {
  return screen.queryByRole('note', { name: /confidentiality notice/i });
}

function bootMarked() {
  return document.documentElement.classList.contains('boot-chat-notice');
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('boot-chat-notice');
  document.documentElement.style.removeProperty('--boot-chat-notice');
});

describe('DataNoticeFooter', () => {
  it('renders nothing while the policy read has not answered', () => {
    // Showing a default while loading flashed the notice in and out for an
    // org that keeps it off.
    state.data = undefined;
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).not.toBeInTheDocument();
  });

  it('renders nothing for an org with no stored policy — the notice is opt-in', () => {
    state.data = null;
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).not.toBeInTheDocument();
  });

  it('renders nothing when the resolved policy keeps it off', () => {
    state.data = { config: { enabled: false } };
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).not.toBeInTheDocument();
  });

  it('renders the platform default when the policy turns it on', () => {
    state.data = { config: { enabled: true } };
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).toHaveTextContent(DEFAULT_TEXT);
  });

  it("renders the org's own text for the reader's language", () => {
    state.data = {
      config: { enabled: true, messages: { en: 'Mind the client data.' } },
    };
    render(<DataNoticeFooter organizationId="org-1" />);
    expect(noticeEl()).toHaveTextContent('Mind the client data.');
  });

  /**
   * The chat's loading skeleton reserves the notice's row from what the
   * footer last showed, so the composer does not shift when the notice
   * mounts on the next load.
   */
  describe('remembering the notice for the loading skeleton', () => {
    it('remembers the shown text and marks <html>', () => {
      state.data = { config: { enabled: true, messages: { en: 'Mind it' } } };
      render(<DataNoticeFooter organizationId="org-1" />);

      expect(window.localStorage.getItem(BOOT_KEY)).toBe('"Mind it"');
      expect(bootMarked()).toBe(true);
    });

    it('forgets a previously shown notice once the org keeps it off', () => {
      window.localStorage.setItem(BOOT_KEY, '"Mind it"');
      state.data = { config: { enabled: false } };
      render(<DataNoticeFooter organizationId="org-1" />);

      expect(window.localStorage.getItem(BOOT_KEY)).toBeNull();
      expect(bootMarked()).toBe(false);
    });

    it('leaves the remembered text alone while the read has no answer', () => {
      window.localStorage.setItem(BOOT_KEY, '"Mind it"');
      state.data = undefined;
      render(<DataNoticeFooter organizationId="org-1" />);

      expect(window.localStorage.getItem(BOOT_KEY)).toBe('"Mind it"');
    });

    it('holds the remembered row, invisible and unannounced, until the read settles', () => {
      window.localStorage.setItem(BOOT_KEY, '"Mind it"');
      state.data = undefined;
      const { container } = render(<DataNoticeFooter organizationId="org-1" />);

      const reserve = container.querySelector('[aria-hidden="true"]');
      expect(reserve).toHaveClass('invisible');
      expect(noticeEl()).not.toBeInTheDocument();
    });

    it('reserves nothing while the read has no answer and nothing is remembered', () => {
      state.data = undefined;
      const { container } = render(<DataNoticeFooter organizationId="org-1" />);

      expect(container.querySelector('.invisible')).toBeNull();
    });

    it('drops the live marker on unmount but keeps the text for the next load', () => {
      state.data = { config: { enabled: true, messages: { en: 'Mind it' } } };
      const { unmount } = render(<DataNoticeFooter organizationId="org-1" />);
      unmount();

      expect(bootMarked()).toBe(false);
      expect(window.localStorage.getItem(BOOT_KEY)).toBe('"Mind it"');
    });
  });
});
