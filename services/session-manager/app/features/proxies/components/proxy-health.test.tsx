import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { proxyCheck } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';

import { ProxyHealth } from './proxy-health';

afterEach(resetLanguage);

describe('ProxyHealth', () => {
  it('says a working proxy works', () => {
    renderApp(<ProxyHealth check={proxyCheck({ status: 'ok' })} />);
    expect(screen.getByText('Working')).toBeVisible();
  });

  it('says a proxy that is being checked is being checked', () => {
    renderApp(
      <ProxyHealth
        check={proxyCheck({ status: 'checking', ok: null, error: null })}
      />,
    );
    // A status word, not a message in progress: no ellipsis in a badge.
    expect(screen.getByText('Checking')).toBeVisible();
  });

  it('says a proxy nobody checked yet is not checked', () => {
    renderApp(
      <ProxyHealth
        check={proxyCheck({
          status: 'unchecked',
          ok: null,
          exitIp: null,
          checkedAt: null,
        })}
      />,
    );
    expect(screen.getByText('Not checked')).toBeVisible();
  });

  it('writes why a proxy does not work under the badge, where it can be read', () => {
    const reason = 'Proxy authentication failed (HTTP 407).';
    renderApp(
      <ProxyHealth
        check={proxyCheck({ status: 'failed', ok: false, error: reason })}
      />,
    );

    expect(screen.getByText('Not working')).toBeVisible();
    expect(screen.getByText(reason)).toBeVisible();
    // Text of the page, never a tooltip's only content: a touch screen and a
    // keyboard have no hover.
    expect(screen.queryByTitle(reason)).not.toBeInTheDocument();
    // A short reason is whole: nothing to open.
    expect(
      screen.queryByRole('button', { name: 'Read more' }),
    ).not.toBeInTheDocument();
  });

  describe('a reason longer than three lines', () => {
    const REASON =
      'Proxy refused the credentials (407) while connecting to the upstream gateway at gw-eu-west-1.proxy-provider.example.com:8443: check the username and password in your dashboard before trying again.';

    // jsdom has no layout: give the clamped box a natural height beyond its
    // three lines, as a browser measures it.
    function overflowThreeLines() {
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(
        96,
      );
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
        48,
      );
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('is cut after three lines behind a button that opens the rest, never a tooltip', async () => {
      overflowThreeLines();
      const { user } = renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'failed', ok: false, error: REASON })}
        />,
      );

      // Every word stays in the page for find-in-page and a screen reader.
      expect(screen.getByText(REASON)).toBeInTheDocument();
      expect(screen.queryByTitle(REASON)).not.toBeInTheDocument();
      const more = screen.getByRole('button', { name: 'Read more' });
      expect(more).toHaveAttribute('aria-expanded', 'false');

      await user.click(more);

      expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByText(REASON)).toBeVisible();
    });

    it('can be opened from the keyboard', async () => {
      overflowThreeLines();
      const { user } = renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'failed', ok: false, error: REASON })}
        />,
      );

      await user.tab();
      expect(screen.getByRole('button', { name: 'Read more' })).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('button', { name: 'Show less' })).toBeVisible();
    });

    it('offers the same words in German', async () => {
      await showLanguage('de');
      overflowThreeLines();
      renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'failed', ok: false, error: REASON })}
        />,
      );

      expect(
        await screen.findByRole('button', { name: 'Weiterlesen' }),
      ).toBeVisible();
    });

    it('has no accessibility violations, closed and open', async () => {
      overflowThreeLines();
      const { user, ...view } = renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'failed', ok: false, error: REASON })}
        />,
      );
      await checkAccessibility(view);

      await user.click(screen.getByRole('button', { name: 'Read more' }));
      await checkAccessibility(view);
    });
  });

  it('still says the check failed when the backend gave no reason', () => {
    renderApp(
      <ProxyHealth
        check={proxyCheck({ status: 'failed', ok: false, error: null })}
      />,
    );
    expect(screen.getByText('Not working')).toBeVisible();
    expect(screen.getByText('The check failed.')).toBeVisible();
  });

  it('speaks German', async () => {
    await showLanguage('de');
    renderApp(
      <ProxyHealth
        check={proxyCheck({ status: 'failed', ok: false, error: null })}
      />,
    );
    expect(screen.getByText('Funktioniert nicht')).toBeVisible();
    expect(screen.getByText('Die Prüfung ist fehlgeschlagen.')).toBeVisible();
  });

  describe('when it was checked', () => {
    const CHECKED = '2026-11-01T12:30:00+00:00';
    const FIVE_MINUTES_LATER = new Date('2026-11-01T12:35:00Z');

    beforeEach(() => {
      // Only the clock: the language loads, and the page reads it again, in real time.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(FIVE_MINUTES_LATER);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('says how long ago, in words that can be read and selected', () => {
      renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'ok', checkedAt: CHECKED })}
        />,
      );
      const when = screen.getByText('Checked 5 minutes ago');
      expect(when).toBeVisible();
      // The time is machine-readable too.
      expect(when.tagName).toBe('TIME');
      expect(when).toHaveAttribute('datetime', CHECKED);
    });

    it('gives the date and the time of the check to a pointer that rests on it, as more than it says', () => {
      renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'ok', checkedAt: CHECKED })}
        />,
      );
      // The zone of the machine decides the day and the hour: the shape is read.
      expect(screen.getByText('Checked 5 minutes ago')).toHaveAttribute(
        'title',
        expect.stringMatching(
          /^Checked (October|November) \d{1,2}, 2026 \d{1,2}:\d{2} (AM|PM)$/,
        ),
      );
    });

    it('reads again as time goes by, with no new answer from the server', () => {
      // The page's own clock ticks here, so every timer is the test's.
      vi.useRealTimers();
      vi.useFakeTimers();
      vi.setSystemTime(FIVE_MINUTES_LATER);
      renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'ok', checkedAt: CHECKED })}
        />,
      );
      expect(screen.getByText('Checked 5 minutes ago')).toBeVisible();

      act(() => {
        vi.advanceTimersByTime(55 * 60_000);
      });

      expect(screen.getByText('Checked an hour ago')).toBeVisible();
    });

    it('does not say "in a few seconds" when the clock of the page is behind the server', () => {
      vi.setSystemTime(new Date('2026-11-01T12:29:50Z'));
      renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'ok', checkedAt: CHECKED })}
        />,
      );
      expect(screen.getByText('Checked a few seconds ago')).toBeVisible();
    });

    it('says it under the reason a proxy does not work, so that the reason stays first', () => {
      const reason = 'Proxy authentication failed (HTTP 407).';
      renderApp(
        <ProxyHealth
          check={proxyCheck({
            status: 'failed',
            ok: false,
            error: reason,
            checkedAt: CHECKED,
          })}
        />,
      );
      const text = screen.getByText(reason);
      const when = screen.getByText('Checked 5 minutes ago');
      expect(
        text.compareDocumentPosition(when) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('keeps the time of the last check while a new one runs, as the address and the ping stay', () => {
      renderApp(
        <ProxyHealth
          check={proxyCheck({
            status: 'checking',
            ok: null,
            checkedAt: CHECKED,
          })}
        />,
      );
      expect(screen.getByText('Checking')).toBeVisible();
      expect(screen.getByText('Checked 5 minutes ago')).toBeVisible();
    });

    it('says nothing of a time it cannot read, rather than a sentence with a hole in it', () => {
      renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'ok', checkedAt: 'yesterday at noon' })}
        />,
      );
      expect(screen.getByText('Working')).toBeVisible();
      expect(screen.queryByText(/^Checked/)).toBeNull();
    });

    it('says nothing of a time when no check ever ended', () => {
      renderApp(
        <ProxyHealth
          check={proxyCheck({
            status: 'unchecked',
            ok: null,
            exitIp: null,
            checkedAt: null,
          })}
        />,
      );
      expect(screen.getByText('Not checked')).toBeVisible();
      expect(screen.queryByText(/^Checked/)).toBeNull();
    });

    it('says it in German, with the date as a German reads it', async () => {
      await showLanguage('de');
      renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'ok', checkedAt: CHECKED })}
        />,
      );
      const when = await screen.findByText('Geprüft vor 5 Minuten');
      expect(when).toBeVisible();
      expect(when).toHaveAttribute(
        'title',
        expect.stringMatching(
          /^Geprüft am \d{1,2}\. (Oktober|November) 2026 \d{2}:\d{2}$/,
        ),
      );
    });

    it('says it in French', async () => {
      await showLanguage('fr');
      renderApp(
        <ProxyHealth
          check={proxyCheck({ status: 'ok', checkedAt: CHECKED })}
        />,
      );
      const when = await screen.findByText('Vérifié il y a 5 minutes');
      expect(when).toBeVisible();
      expect(when).toHaveAttribute(
        'title',
        expect.stringMatching(
          /^Vérifié le \d{1,2} (octobre|novembre) 2026 \d{2}:\d{2}$/,
        ),
      );
    });
  });

  it.each([
    ['ok', proxyCheck({ status: 'ok' })],
    ['checking', proxyCheck({ status: 'checking', ok: null })],
    ['unchecked', proxyCheck({ status: 'unchecked', ok: null })],
    [
      'failed',
      proxyCheck({ status: 'failed', ok: false, error: 'Connection refused' }),
    ],
  ])('has no accessibility violations (%s)', async (_state, check) => {
    const view = renderApp(<ProxyHealth check={check} />);
    await checkAccessibility(view);
  });
});
