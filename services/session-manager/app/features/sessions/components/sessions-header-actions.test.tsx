import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadJson } from '@/app/lib/download';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta } from '@/tests/utils/fixtures';
import { countWrites, heldByWrites } from '@/tests/utils/mutation-cache';
import { renderApp } from '@/tests/utils/render';

vi.mock('@/app/lib/download', () => ({ downloadJson: vi.fn() }));

import { ToastList, shownToasts } from '@/tests/utils/toast-list';

import { SessionsHeaderActions } from './sessions-header-actions';

const EXPORT = {
  exported_at: '2026-11-01T12:00:00Z',
  proxies: [
    {
      proxy_key: 'http|198.51.100.4|8080||',
      name: '0001',
      protocol: 'http',
      host: '198.51.100.4',
      port: 8080,
      status: 'active',
      fallback_mode: 'none',
      expiry_warn_days: 7,
    },
  ],
  accounts: [],
};

function renderActions() {
  const onAdd = vi.fn();
  const view = renderApp(
    <>
      <SessionsHeaderActions onAdd={onAdd} />
      <ToastList />
    </>,
  );
  return { ...view, onAdd };
}

const addButton = () => screen.getByRole('button', { name: 'Add session' });
const moreButton = () => screen.getByRole('button', { name: 'More actions' });

beforeEach(() => {
  vi.mocked(downloadJson).mockClear();
  installFakeApi({ 'GET /meta': meta() });
});

describe('SessionsHeaderActions', () => {
  it('adds a session through the button named for it', async () => {
    const { user, onAdd } = renderActions();
    await waitFor(() => expect(addButton()).toBeEnabled());

    await user.click(addButton());

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('cannot add while the browser is being installed, and says why', async () => {
    installFakeApi({
      'GET /meta': meta({ browserInstalled: false, browserInstalling: true }),
    });
    const { user, onAdd } = renderActions();
    await waitFor(() =>
      expect(addButton()).toHaveAttribute('aria-disabled', 'true'),
    );

    await user.click(addButton());
    expect(onAdd).not.toHaveBeenCalled();

    addButton().focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'The browser is being installed.',
    );
  });

  it('cannot add while the browser is missing, and says why', async () => {
    installFakeApi({ 'GET /meta': meta({ browserInstalled: false }) });
    renderActions();
    await waitFor(() =>
      expect(addButton()).toHaveAttribute('aria-disabled', 'true'),
    );

    addButton().focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "The browser isn't installed yet.",
    );
  });

  it('offers the export in a menu, and says it holds the proxy passwords', async () => {
    const { user } = renderActions();

    await user.click(moreButton());

    const item = await screen.findByRole('menuitem', {
      name: /Export session proxies as JSON/,
    });
    expect(item).toHaveTextContent('Includes the proxy passwords.');
  });

  it('downloads the proxies of the sessions as proxy.json', async () => {
    const api = installFakeApi({
      'GET /meta': meta(),
      'GET /sessions/export-proxies': EXPORT,
    });
    const { user } = renderActions();
    await user.click(moreButton());

    await user.click(
      await screen.findByRole('menuitem', {
        name: /Export session proxies as JSON/,
      }),
    );

    await waitFor(() =>
      expect(downloadJson).toHaveBeenCalledWith('proxy.json', EXPORT),
    );
    expect(api.callsTo('GET /sessions/export-proxies')).toHaveLength(1);
    await waitFor(() =>
      expect(shownToasts()).toEqual([
        { title: 'proxy.json exported', description: '' },
      ]),
    );
  });

  // The file holds the proxy passwords. A mutation keeps what it answered, in
  // the mutation cache, for minutes after the menu is gone.
  it('keeps nothing of the file in the memory of the page once it is downloaded', async () => {
    const withPassword = {
      ...EXPORT,
      proxies: [
        { ...EXPORT.proxies[0], username: 'ada', password: 'PROBE-PASSWORD' },
      ],
    };
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions/export-proxies': withPassword,
    });
    const { user, queryClient, unmount } = renderActions();
    await user.click(moreButton());

    await user.click(
      await screen.findByRole('menuitem', {
        name: /Export session proxies as JSON/,
      }),
    );

    await waitFor(() =>
      expect(downloadJson).toHaveBeenCalledWith('proxy.json', withPassword),
    );
    await waitFor(() => expect(shownToasts()).toHaveLength(1));
    expect(heldByWrites(queryClient)).not.toContain('PROBE-PASSWORD');
    unmount();
    await waitFor(() => expect(countWrites(queryClient)).toBe(0));
  });

  it('tells once, as a toast, that there is nothing to export', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions/export-proxies': failure(409, 'nothing_to_export'),
    });
    const { user } = renderActions();
    await user.click(moreButton());

    await user.click(
      await screen.findByRole('menuitem', {
        name: /Export session proxies as JSON/,
      }),
    );

    await waitFor(() => expect(shownToasts()).toHaveLength(1));
    expect(shownToasts()[0]).toEqual({
      title: "Couldn't export the proxies",
      description: 'No session has a proxy yet, so there is nothing to export.',
    });
    expect(downloadJson).not.toHaveBeenCalled();
  });

  it('shows the export under way on the menu button', async () => {
    let finish: (() => void) | undefined;
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions/export-proxies': () =>
        new Promise((resolve) => {
          finish = () => resolve(EXPORT);
        }),
    });
    const { user } = renderActions();
    await user.click(moreButton());
    await user.click(
      await screen.findByRole('menuitem', {
        name: /Export session proxies as JSON/,
      }),
    );

    await waitFor(() =>
      expect(moreButton()).toHaveAttribute('aria-busy', 'true'),
    );
    finish?.();
    await waitFor(() => expect(moreButton()).not.toHaveAttribute('aria-busy'));
  });

  it('works with the keyboard alone', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'GET /sessions/export-proxies': EXPORT,
    });
    const { user } = renderActions();
    await user.tab();
    await user.tab();
    expect(moreButton()).toHaveFocus();

    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem')).toHaveFocus(),
    );
    await user.keyboard('{Enter}');

    await waitFor(() => expect(downloadJson).toHaveBeenCalled());
  });

  it('has no accessibility violations', async () => {
    const { user } = renderActions();
    await waitFor(() => expect(addButton()).toBeEnabled());
    await user.click(moreButton());
    const menu = await screen.findByRole('menu');
    await checkAccessibility(menu);
  });
});
