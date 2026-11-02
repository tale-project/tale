import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi, list } from '@/tests/utils/fake-api';
import { meta, runningSession, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { navigate, setOpenPath } from '@/tests/utils/sessions-router';

import { ProxyFlowProvider } from './proxy-flow-provider';
import { SessionsPanel } from './sessions-panel';

beforeEach(() => {
  navigate.mockClear();
  setOpenPath('/sessions');
});

afterEach(async () => {
  // Unmounted first: the language is changed under nothing that listens.
  cleanup();
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

describe('SessionsPanel', () => {
  it('names the section in its header, with the two actions the section has', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions': list([session()]),
    });
    renderApp(
      <ProxyFlowProvider>
        <SessionsPanel />
      </ProxyFlowProvider>,
    );

    const panel = screen.getByRole('navigation', { name: 'Sessions' });
    expect(
      within(panel).getByRole('heading', { level: 2, name: 'Sessions' }),
    ).toBeVisible();
    expect(
      within(panel).getByRole('button', { name: 'Add session' }),
    ).toBeVisible();
    expect(
      within(panel).getByRole('button', { name: 'More actions' }),
    ).toBeVisible();
    expect(
      await within(panel).findByRole('link', { name: /0001/ }),
    ).toBeVisible();
  });

  it('hands the keyboard to Add session when a retry that worked takes the alert of a failed read away', async () => {
    let broken = true;
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions': () =>
        broken ? failure(500, 'http_500') : list([session()]),
    });
    const { user } = renderApp(
      <ProxyFlowProvider>
        <SessionsPanel />
      </ProxyFlowProvider>,
    );
    const alert = await screen.findByRole('alert');

    broken = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: /0001/ })).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add session' })).toHaveFocus(),
    );
  });

  it('adds a session from the header: the dialog, the new session, and its page', async () => {
    const api = installFakeApi({
      'GET /meta': meta({ nextSessionName: '0002' }),
      'GET /sessions': list([session()]),
      'POST /sessions': session({ id: 2, name: 'Shop', status: 'starting' }),
    });
    const { user } = renderApp(
      <ProxyFlowProvider>
        <SessionsPanel />
      </ProxyFlowProvider>,
    );
    await screen.findByRole('link', { name: /0001/ });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add session' })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: 'Add session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add session' });
    await user.type(
      within(dialog).getByRole('textbox', { name: /Name/ }),
      'Shop',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add session' }),
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/sessions/$sessionId',
        params: { sessionId: '2' },
      }),
    );
    expect(api.callsTo('POST /sessions')[0]?.body).toEqual({
      name: 'Shop',
      os: 'random',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    // The list was asked again, so the new session shows.
    expect(api.callsTo('GET /sessions').length).toBeGreaterThan(1);
  });

  it('opens the same dialog from the empty list', async () => {
    installFakeApi({
      'GET /meta': meta({ counts: { proxies: 2 } }),
      'GET /sessions': list([]),
    });
    const { user } = renderApp(
      <ProxyFlowProvider>
        <SessionsPanel />
      </ProxyFlowProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Add session' }),
      ).toHaveLength(2),
    );
    const inTheList = screen.getAllByRole('button', {
      name: 'Add session',
    })[1];
    await waitFor(() => expect(inTheList).toBeEnabled());
    await user.click(inTheList);

    expect(
      await screen.findByRole('dialog', { name: 'Add session' }),
    ).toBeVisible();
  });

  it('marks the open session in the list', async () => {
    setOpenPath('/sessions/2');
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions': list([session({ id: 2, name: '0002' }), session()]),
    });
    renderApp(
      <ProxyFlowProvider>
        <SessionsPanel />
      </ProxyFlowProvider>,
    );

    expect(await screen.findByRole('link', { name: /0002/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /0001/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('has no accessibility violations', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions': list([
        runningSession(),
        session({ id: 2, name: '0002' }),
      ]),
    });
    const view = renderApp(
      <ProxyFlowProvider>
        <SessionsPanel />
      </ProxyFlowProvider>,
    );
    await screen.findAllByRole('link');
    await checkAccessibility(view);
  });

  describe('in German', () => {
    // The language is the preference of the browser, which the app reads on start.
    beforeEach(() => {
      localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    });

    it('speaks German, with the count in the right plural form', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([session()]),
      });
      renderApp(
        <ProxyFlowProvider>
          <SessionsPanel />
        </ProxyFlowProvider>,
      );

      expect(
        await screen.findByRole('navigation', { name: 'Sitzungen' }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Sitzung hinzufügen' }),
      ).toBeVisible();
      expect(await screen.findByText('1 Sitzung wird angezeigt')).toBeVisible();
      expect(
        screen.getByRole('button', { name: '0001 starten' }),
      ).toBeVisible();
    });

    it('counts several sessions, and the ones still to load', async () => {
      const all = Array.from({ length: 60 }, (_, index) =>
        session({ id: 60 - index, name: String(60 - index) }),
      );
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': (request) =>
          list(all.slice(0, Number(request.query.get('limit'))), all.length),
      });
      renderApp(
        <ProxyFlowProvider>
          <SessionsPanel />
        </ProxyFlowProvider>,
      );

      expect(
        await screen.findByText('50 von 60 Sitzungen werden angezeigt'),
      ).toBeVisible();
    });
  });
});
