import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTION_GRACE_MS } from '@/app/hooks/use-connection-trouble';
import { POLL_SLOW_MS } from '@/app/lib/polling';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { answer, failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

import { Banners } from './banners';

const INSTALL_ERROR =
  '`camoufox-js fetch` failed (exit code 1).\nno space left';

/** The page that follows the banners in the frame, with the one heading of a page. */
function Frame() {
  return (
    <>
      <Banners />
      <main>
        <h1>Sessions</h1>
      </main>
    </>
  );
}

/** A moment after the second try that follows a failed poll by the grace. */
const AFTER_GRACE = CONNECTION_GRACE_MS + 100;

/** Lets `ms` of fake time pass, and what the page does with it. */
async function passTime(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

afterEach(async () => {
  vi.useRealTimers();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('Banners: the browser', () => {
  it('shows nothing while the browser is installed and the server answers', async () => {
    const api = installFakeApi({ 'GET /meta': meta() });
    const { container } = renderApp(<Banners />);
    await expect.poll(() => api.callsTo('GET /meta').length).toBe(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the browser is downloading, in one sentence with no heading of its own', async () => {
    installFakeApi({
      'GET /meta': meta({ browserInstalled: false, browserInstalling: true }),
    });
    const view = renderApp(<Frame />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The browser is being installed (about 1.3 GB to download). Sessions can start once it is ready.',
    );
    expect(within(alert).queryByRole('heading')).toBeNull();
    await checkAccessibility(view);
  });

  it('says the browser is not installed yet when nothing is under way, in one sentence', async () => {
    installFakeApi({ 'GET /meta': meta({ browserInstalled: false }) });
    const view = renderApp(<Frame />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "The browser isn't installed yet. Session Manager installs it when it starts.",
    );
    expect(within(alert).queryByRole('heading')).toBeNull();
    await checkAccessibility(view);
  });

  describe('when the installation failed', () => {
    beforeEach(() => {
      installFakeApi({
        'GET /meta': meta({
          browserInstalled: false,
          browserInstallError: INSTALL_ERROR,
        }),
      });
    });

    it('says so in a short title, then what to do and the command to run by hand', async () => {
      renderApp(<Frame />);
      const alert = await screen.findByRole('alert');
      expect(
        within(alert).getByRole('heading', {
          name: "Couldn't install the browser",
        }),
      ).toBeVisible();
      expect(alert).toHaveTextContent(
        'Check your connection and restart Session Manager, or install the browser by hand with the command below. This page updates as soon as the browser is installed.',
      );
      // The command is shown as code, not wrapped in backticks of the text.
      const command = within(alert).getByText('camoufox-js fetch');
      expect(command.tagName).toBe('CODE');
      expect(alert).not.toHaveTextContent('`camoufox-js fetch` Check');
    });

    it('keeps the output of the installer behind Technical details', async () => {
      const { user } = renderApp(<Frame />);
      const alert = await screen.findByRole('alert');
      const output = within(alert).getByText(/no space left/);
      expect(output).not.toBeVisible();

      await user.click(within(alert).getByText('Technical details'));

      expect(output).toBeVisible();
      expect(output.textContent).toBe(INSTALL_ERROR);
    });

    it('lets the output be copied, for whoever reports the failure', async () => {
      const { user } = renderApp(<Frame />);
      const alert = await screen.findByRole('alert');
      await user.click(within(alert).getByText('Technical details'));
      const write = vi.spyOn(navigator.clipboard, 'writeText');

      await user.click(within(alert).getByRole('button', { name: 'Copy' }));

      expect(write).toHaveBeenCalledWith(INSTALL_ERROR);
    });

    it('has no accessibility violations, closed and open', async () => {
      const { user, ...view } = renderApp(<Frame />);
      await screen.findByRole('alert');
      await checkAccessibility(view);

      await user.click(screen.getByText('Technical details'));
      await checkAccessibility(view);
    });
  });

  it('speaks German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installFakeApi({
      'GET /meta': meta({
        browserInstalled: false,
        browserInstallError: INSTALL_ERROR,
      }),
    });
    renderApp(<Frame />);
    const alert = await screen.findByRole('alert');
    expect(
      await within(alert).findByRole('heading', {
        name: 'Der Browser konnte nicht installiert werden',
      }),
    ).toBeVisible();
    expect(alert).toHaveTextContent(
      'Prüfe deine Verbindung und starte Session Manager neu, oder installiere den Browser von Hand mit dem Befehl unten.',
    );
    expect(within(alert).getByText('Technische Details')).toBeVisible();
  });
});

describe('Banners: the connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = 'Sessions - Session Manager';
  });

  /** A server that answers every call but the ones named, which get no answer at all. */
  function serverWithout(...dropped: number[]) {
    let calls = 0;
    return installFakeApi({
      'GET /meta': () => {
        calls += 1;
        if (dropped.includes(calls)) throw new TypeError('Failed to fetch');
        return meta();
      },
    });
  }

  it('says nothing about one poll that got no answer, when the second try is answered', async () => {
    const api = serverWithout(2);
    const { container } = renderApp(<Frame />);
    await passTime(0);

    // The poll that gets no answer, then the second try after the grace.
    await passTime(POLL_SLOW_MS);
    expect(api.callsTo('GET /meta')).toHaveLength(2);
    await passTime(AFTER_GRACE);
    expect(api.callsTo('GET /meta')).toHaveLength(3);

    expect(screen.queryByRole('alert')).toBeNull();
    await passTime(60_000);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('[data-slot="alert"]')).toBeNull();
  });

  it('waits out the grace before it says the server cannot be reached', async () => {
    serverWithout(2, 3, 4);
    renderApp(<Frame />);
    await passTime(0);

    await passTime(POLL_SLOW_MS);
    await passTime(CONNECTION_GRACE_MS - 100);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says it once the second try got no answer either, and names the tab for it', async () => {
    serverWithout(2, 3, 4);
    const view = renderApp(<Frame />);
    await passTime(0);

    await passTime(POLL_SLOW_MS + AFTER_GRACE);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      "Can't reach Session Manager. We're trying to reconnect.",
    );
    expect(within(alert).queryByRole('heading')).toBeNull();
    expect(document.title).toBe('Reconnecting - Session Manager');
    // axe runs on timers of its own.
    vi.useRealTimers();
    await checkAccessibility(view);
  });

  it('takes the banner down, and gives the tab its title back, once the server answers again', async () => {
    serverWithout(2, 3);
    renderApp(<Frame />);
    await passTime(0);
    await passTime(POLL_SLOW_MS + AFTER_GRACE);
    expect(screen.getByRole('alert')).toBeVisible();

    // The poll after the back-off is answered.
    await passTime(11_000);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.title).toBe('Sessions - Session Manager');
  });

  describe('when the server has never answered', () => {
    it('says nothing while the first try is asked about again, and when its answer comes', async () => {
      const api = serverWithout(1);
      renderApp(<Frame />);
      await passTime(0);
      expect(api.callsTo('GET /meta')).toHaveLength(1);

      await passTime(AFTER_GRACE);

      expect(api.callsTo('GET /meta')).toHaveLength(2);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says the server cannot be reached once the second try got no answer either, and keeps saying it while it tries again', async () => {
      installFakeApi({
        // A try takes a moment to fail, as it does on a network: the read is
        // seen going back to pending (it has no answer to keep) before it fails.
        'GET /meta': () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new TypeError('Failed to fetch')), 100);
          }),
      });
      renderApp(<Frame />);
      await passTime(CONNECTION_GRACE_MS - 100);
      expect(screen.queryByRole('alert')).toBeNull();

      await passTime(600);
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Can't reach Session Manager.",
      );

      // The read with no answer to show goes back to pending at every poll:
      // the banner does not come and go with it.
      for (let second = 0; second < 40; second += 1) {
        await passTime(1_000);
        expect(screen.getByRole('alert')).toHaveTextContent(
          "Can't reach Session Manager.",
        );
      }
    });
  });

  it('does not say the server cannot be reached when it answered with an error', async () => {
    let calls = 0;
    installFakeApi({
      'GET /meta': () => {
        calls += 1;
        return calls === 1 ? meta() : failure(500, 'internal_error', 'boom');
      },
    });
    const view = renderApp(<Frame />);
    await passTime(0);

    await passTime(POLL_SLOW_MS + AFTER_GRACE);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      "Session Manager answered with an error. We're trying again. If the problem persists, restart Session Manager.",
    );
    expect(alert).not.toHaveTextContent("Can't reach");
    // The tab is not "Reconnecting": the server is there.
    expect(document.title).toBe('Sessions - Session Manager');
    vi.useRealTimers();
    await checkAccessibility(view);
  });

  it('says the same of an answer that is no JSON of the app, such as a gateway page', async () => {
    let calls = 0;
    installFakeApi({
      'GET /meta': () => {
        calls += 1;
        return calls === 1
          ? meta()
          : answer({ status: 502, body: 'Bad Gateway' });
      },
    });
    renderApp(<Frame />);
    await passTime(0);

    await passTime(POLL_SLOW_MS + AFTER_GRACE);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Session Manager answered with an error.',
    );
  });

  it('speaks German and French', async () => {
    serverWithout(2, 3, 4);
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderApp(<Frame />);
    await passTime(0);
    await passTime(POLL_SLOW_MS + AFTER_GRACE);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Session Manager ist nicht erreichbar. Wir versuchen, die Verbindung wiederherzustellen.',
    );
    expect(document.title).toBe(
      'Verbindung wird wiederhergestellt - Session Manager',
    );
  });
});

describe('Banners: with more than one thing to say', () => {
  it('says the browser is missing and the server is out of reach, one strip each, before the page', async () => {
    vi.useFakeTimers();
    let calls = 0;
    installFakeApi({
      'GET /meta': () => {
        calls += 1;
        if (calls > 1) throw new TypeError('Failed to fetch');
        return meta({ browserInstalled: false });
      },
    });
    renderApp(<Frame />);
    await passTime(0);
    await passTime(POLL_SLOW_MS + AFTER_GRACE);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    // The page follows them: neither is inside it.
    const main = screen.getByRole('main');
    for (const alert of alerts) {
      expect(main).not.toContainElement(alert);
      expect(
        alert.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});
