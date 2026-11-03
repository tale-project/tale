import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@tale/ui/adaptive-header';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi, list } from '@/tests/utils/fake-api';
import { meta, runningSession, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { navigate, setOpenPath } from '@/tests/utils/sessions-router';
import { showPhone } from '@/tests/utils/viewport';

import { ProxyFlowProvider } from './proxy-flow-provider';
import { SessionsIndexPage } from './sessions-index-page';

/** The page in the frame that gives it its header: the mobile slot, and `main`. */
function renderPage() {
  return renderApp(
    <ProxyFlowProvider>
      <AdaptiveHeaderProvider>
        <header>
          <AdaptiveHeaderSlot />
        </header>
        <main>
          <SessionsIndexPage />
        </main>
      </AdaptiveHeaderProvider>
    </ProxyFlowProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  setOpenPath('/sessions');
});

afterEach(() => {
  showPhone(false);
});

describe('SessionsIndexPage beside the panel', () => {
  it('says no session is open, and to choose one', async () => {
    installFakeApi({
      'GET /meta': meta({ counts: { sessions: 3 } }),
    });
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sessions' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'No session open' }),
    ).toBeVisible();
    expect(
      await screen.findByText('Choose a session from the list to open it.'),
    ).toBeVisible();
  });

  it('names the page once, as its one heading, for the panel beside it shows the name of the section', async () => {
    installFakeApi({ 'GET /meta': meta({ counts: { sessions: 3 } }) });
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Sessions' });
    // Its header bar stays, so that the line under it meets the panel's, but
    // it shows no second "Sessions": a browser, not this test, sees that.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('says where the sessions will be, not what to add, when there are none: the panel carries the way to add one', async () => {
    installFakeApi({ 'GET /meta': meta({ counts: { sessions: 0 } }) });
    renderPage();

    expect(
      await screen.findByText('Sessions you add appear on the left.'),
    ).toBeVisible();
    expect(
      screen.queryByText('Choose a session from the list to open it.'),
    ).toBeNull();
    // Nothing here competes with the panel's one call to action.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not say what to do until it knows whether there are sessions', () => {
    installFakeApi({ 'GET /meta': () => new Promise(() => {}) });
    renderPage();

    expect(
      screen.getByRole('heading', { name: 'No session open' }),
    ).toBeVisible();
    expect(
      screen.queryByText('Choose a session from the list to open it.'),
    ).toBeNull();
    expect(
      screen.queryByText('Sessions you add appear on the left.'),
    ).toBeNull();
  });

  it('keeps its actions in the panel: the page has none of its own', async () => {
    installFakeApi({ 'GET /meta': meta({ counts: { sessions: 2 } }) });
    renderPage();
    await screen.findByText('Choose a session from the list to open it.');

    expect(screen.queryByRole('button', { name: 'Add session' })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    installFakeApi({ 'GET /meta': meta({ counts: { sessions: 2 } }) });
    const view = renderPage();
    await screen.findByText('Choose a session from the list to open it.');
    await checkAccessibility(view);
  });
});

describe('SessionsIndexPage on a phone', () => {
  beforeEach(() => {
    showPhone(true);
  });

  it('is the list of sessions, whole, each a link to its page', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions': list([
        runningSession(),
        session({ id: 2, name: '0002' }),
      ]),
    });
    renderPage();

    const links = await screen.findAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/sessions/1',
      '/sessions/2',
    ]);
    expect(screen.queryByText('No session open')).toBeNull();
  });

  it('has its own header: the name of the section and the actions of the panel', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions': list([session()]),
    });
    renderPage();
    await screen.findByRole('link', { name: /0001/ });

    const header = screen.getByRole('banner');
    const title = within(header).getByRole('heading', {
      level: 1,
      name: 'Sessions',
    });
    expect(title).toBeVisible();
    // There is no panel here to show it: this is the one place that does.
    expect(
      within(header).getByRole('button', { name: 'Add session' }),
    ).toBeVisible();
    expect(
      within(header).getByRole('button', { name: 'More actions' }),
    ).toBeVisible();
  });

  it('adds a session from its header', async () => {
    const api = installFakeApi({
      'GET /meta': meta(),
      'GET /sessions': list([session()]),
      'POST /sessions': session({ id: 2, name: '0002' }),
    });
    const { user } = renderPage();
    await screen.findByRole('link', { name: /0001/ });
    const add = within(screen.getByRole('banner')).getByRole('button', {
      name: 'Add session',
    });
    await waitFor(() => expect(add).toBeEnabled());

    await user.click(add);
    const dialog = await screen.findByRole('dialog', { name: 'Add session' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Add session' }),
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/sessions/$sessionId',
        params: { sessionId: '2' },
      }),
    );
    expect(api.callsTo('POST /sessions')).toHaveLength(1);
  });

  it('offers to add the first session on its empty list, under a second-level title', async () => {
    installFakeApi({
      'GET /meta': meta({ counts: { proxies: 2 } }),
      'GET /sessions': list([]),
    });
    const { user } = renderPage();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No sessions yet' }),
    ).toBeVisible();
    // The button of the empty list, not the one of the header.
    const [, inTheList] = screen.getAllByRole('button', {
      name: 'Add session',
    });
    await waitFor(() => expect(inTheList).toBeEnabled());
    await user.click(inTheList);
    expect(
      await screen.findByRole('dialog', { name: 'Add session' }),
    ).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions': list([
        runningSession(),
        session({ id: 2, name: '0002' }),
      ]),
    });
    const view = renderPage();
    await screen.findAllByRole('link');
    await checkAccessibility(view);
  });
});
