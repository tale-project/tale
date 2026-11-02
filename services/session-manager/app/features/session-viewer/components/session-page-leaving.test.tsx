import { Toaster } from '@tale/ui/toaster';
import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import { installFakeApi, list } from '@/tests/utils/fake-api';
import { meta, session } from '@/tests/utils/fixtures';
import { resetLanguage } from '@/tests/utils/language';
import { renderRouter } from '@/tests/utils/route-page';

import { SessionPage } from './session-page';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetLanguage();
});

/*
 * The page of a session on a real router, as the app mounts it: inside the
 * main area the skip link leads to (`main#main-content`, which takes the
 * keyboard), with the list of sessions to leave for. The list's route can be
 * held back, as the code of a page is on a slow connection: until it is let
 * go, the page of the session is still the one on screen.
 */
function renderPage({ held = false }: { held?: boolean } = {}) {
  let release: () => void = () => {};
  const gate = held
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : undefined;

  const root = createRootRoute({
    component: () => (
      <ProxyFlowProvider>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <Toaster />
      </ProxyFlowProvider>
    ),
  });
  const sessions = createRoute({
    getParentRoute: () => root,
    path: '/sessions',
    loader: () => gate,
    component: () => <h1>The sessions</h1>,
  });
  const open = createRoute({
    getParentRoute: () => root,
    path: '/sessions/$sessionId',
    component: function OpenPage() {
      const { sessionId } = open.useParams();
      return <SessionPage sessionId={Number(sessionId)} />;
    },
  });
  const state = { deleted: false };
  const api = installFakeApi({
    'GET /meta': meta(),
    'GET /secrets': list([]),
    'GET /sessions/:id': () =>
      session({ id: 5, name: 'Shop', status: 'stopped' }),
    'DELETE /sessions/:id': () => {
      state.deleted = true;
      return undefined;
    },
  });
  const view = renderRouter(root.addChildren([sessions, open]), '/sessions/5');
  return { ...view, api, state, release };
}

const main = () => {
  const area = document.getElementById('main-content');
  if (area === null) throw new Error('the page has no main area');
  return area;
};

/** Deletes the session from the menu in the header of its page. */
async function deleteFromItsPage(user: ReturnType<typeof renderPage>['user']) {
  await user.click(
    await screen.findByRole('button', { name: 'Actions for Shop' }),
  );
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete "Shop"?' });
  const confirm = within(dialog).getByRole('button', {
    name: 'Delete session',
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  return dialog;
}

describe('leaving the page of a deleted session', () => {
  it('puts the keyboard in the main area once the list has come, also when it was slow to come', async () => {
    const { user, state, release } = renderPage({ held: true });
    const dialog = await deleteFromItsPage(user);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(state.deleted).toBe(true));
    // The list has not come: the header, with the menu button the dialog gave
    // the keyboard back to, is still the page.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Shop' }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Actions for Shop' }),
      ).toHaveFocus(),
    );

    release();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'The sessions' }),
    ).toBeVisible();
    await waitFor(() => expect(main()).toHaveFocus());
  });

  it('puts it there when the list came at once', async () => {
    const { user } = renderPage();

    await deleteFromItsPage(user);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'The sessions' }),
    ).toBeVisible();
    await waitFor(() => expect(main()).toHaveFocus());
  });
});

describe('the way back to the list, on a phone', () => {
  it('leads to the list without saying it is the page that is open: the page is the session', async () => {
    renderPage();

    const back = await screen.findByRole('link', { name: 'Back' });

    expect(back).toHaveAttribute('href', '/sessions');
    expect(back).not.toHaveAttribute('aria-current');
  });
});
