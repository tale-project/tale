import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { proxy, proxyCheck, sessionRef } from '@/tests/utils/fixtures';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/proxies');
});

import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderInShell } from '@/tests/utils/render';

import { ProxyRowActions } from './proxy-row-actions';

afterEach(resetLanguage);

function renderActions(row = proxy({ id: 4 })) {
  return renderInShell(<ProxyRowActions proxy={row} />);
}

const menuButton = () =>
  screen.getByRole('button', { name: 'Actions for 198.51.100.4:8080' });

type User = ReturnType<typeof renderActions>['user'];

async function chooseFromMenu(user: User, item: string) {
  await user.click(menuButton());
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

const stopped = sessionRef({ id: 7, name: 'work', status: 'stopped' });
const running = sessionRef({ id: 7, name: 'work', status: 'running' });

describe('ProxyRowActions menu', () => {
  it('is named after its proxy, so every row has a menu of its own', () => {
    renderActions(proxy({ host: '2001:db8::1', port: 3128 }));
    expect(
      screen.getByRole('button', { name: 'Actions for [2001:db8::1]:3128' }),
    ).toBeVisible();
  });

  it('offers to check the proxy and to delete it, the deletion apart', async () => {
    const { user } = renderActions();

    await user.click(menuButton());

    expect(
      await screen.findByRole('menuitem', { name: 'Check' }),
    ).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('checks the proxy, and says so', async () => {
    const api = installFakeApi({ 'POST /proxies/:id/check': proxy({ id: 4 }) });
    const { user } = renderActions(proxy({ id: 4 }));

    await chooseFromMenu(user, 'Check');

    await waitFor(() =>
      expect(api.callsTo('POST /proxies/:id/check')).toHaveLength(1),
    );
    expect(api.callsTo('POST /proxies/:id/check')[0]?.params.id).toBe('4');
    expect(await screen.findByText('Check started')).toBeVisible();
  });

  it('cannot check a proxy that is being checked', async () => {
    const api = installFakeApi({});
    const { user } = renderActions(
      proxy({ check: proxyCheck({ status: 'checking' }) }),
    );

    await user.click(menuButton());
    const item = await screen.findByRole('menuitem', { name: 'Check' });
    await user.click(item);

    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(api.calls).toHaveLength(0);
  });

  it('tells a check that could not start once, as a notice', async () => {
    installFakeApi({
      'POST /proxies/:id/check': failure(404, 'proxy_not_found'),
    });
    const { user } = renderActions();

    await chooseFromMenu(user, 'Check');

    expect(await screen.findByText("Couldn't check the proxy")).toBeVisible();
    expect(screen.getAllByText("Couldn't check the proxy")).toHaveLength(1);
  });

  it('works from the keyboard', async () => {
    const api = installFakeApi({ 'POST /proxies/:id/check': proxy({ id: 4 }) });
    const { user } = renderActions();

    menuButton().focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(api.callsTo('POST /proxies/:id/check')).toHaveLength(1),
    );
  });

  it('speaks German', async () => {
    await showLanguage('de');
    const { user } = renderActions();

    await user.click(
      screen.getByRole('button', { name: 'Aktionen für 198.51.100.4:8080' }),
    );

    expect(
      await screen.findByRole('menuitem', { name: 'Prüfen' }),
    ).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeVisible();
  });

  it('has no accessibility violations, closed and open', async () => {
    const view = renderActions();
    await checkAccessibility(view);

    await view.user.click(menuButton());
    await checkAccessibility(await screen.findByRole('menu'));
  });
});

describe('ProxyRowActions deleting', () => {
  it('deletes a proxy nobody has after one question', async () => {
    const api = installFakeApi({ 'DELETE /proxies/:id': undefined });
    const { user } = renderActions();

    await chooseFromMenu(user, 'Delete');
    expect(
      await screen.findByRole('dialog', { name: 'Delete proxy?' }),
    ).toBeVisible();
    expect(api.calls).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete proxy' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    const [call] = api.callsTo('DELETE /proxies/:id');
    expect(call?.params.id).toBe('4');
    expect(call?.query.get('force')).toBe('false');
    expect(await screen.findByText('Proxy deleted')).toBeVisible();
  });

  it('gives the focus back to the menu button when the question is declined', async () => {
    const api = installFakeApi({});
    const { user } = renderActions();

    await chooseFromMenu(user, 'Delete');
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(menuButton()).toHaveFocus());
    expect(api.calls).toHaveLength(0);
  });

  it('closes the question on Escape without deleting', async () => {
    const api = installFakeApi({});
    const { user } = renderActions();

    await chooseFromMenu(user, 'Delete');
    await screen.findByRole('dialog');
    // The menu button's tooltip reopens as the menu hands back its focus and
    // is the layer an Escape closes first (jsdom has no `:focus-visible` to
    // tell it not to); the second one reaches the dialog.
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.calls).toHaveLength(0);
  });

  it('can be done from the keyboard alone', async () => {
    const api = installFakeApi({ 'DELETE /proxies/:id': undefined });
    const { user } = renderActions();

    menuButton().focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(
      await screen.findByRole('dialog', { name: 'Delete proxy?' }),
    ).toBeVisible();
    // Close, Cancel, then the action: Cancel comes first, as it should.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Delete proxy' })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(api.callsTo('DELETE /proxies/:id')).toHaveLength(1),
    );
  });

  describe('a proxy a stopped session has', () => {
    it('asks first, and deletes it with the person agreeing', async () => {
      const api = installFakeApi({ 'DELETE /proxies/:id': undefined });
      const { user } = renderActions(proxy({ id: 4, session: stopped }));

      await chooseFromMenu(user, 'Delete');
      expect(
        await screen.findByRole('dialog', { name: 'Delete a proxy in use?' }),
      ).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Delete proxy' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      const calls = api.callsTo('DELETE /proxies/:id');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.query.get('force')).toBe('true');
    });
  });

  describe('a proxy a stopped session took since the table was read', () => {
    it('asks again, and deletes it once the person agrees', async () => {
      const api = installFakeApi({
        'DELETE /proxies/:id': ({ query }) =>
          query.get('force') === 'true'
            ? undefined
            : failure(409, 'proxy_in_use', 'x', { session: stopped }),
      });
      const { user } = renderActions();

      await chooseFromMenu(user, 'Delete');
      await user.click(
        await screen.findByRole('button', { name: 'Delete proxy' }),
      );

      // The refusal is the dialog's to word: the question changes, no toast.
      expect(
        await screen.findByRole('dialog', { name: 'Delete a proxy in use?' }),
      ).toBeVisible();
      expect(
        screen.getByText(
          'The session "work" uses 198.51.100.4:8080. If you delete the proxy, the session gets another one on its next start.',
        ),
      ).toBeVisible();
      expect(
        screen.queryByText("Couldn't delete the proxy"),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Delete proxy' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(
        api
          .callsTo('DELETE /proxies/:id')
          .map((call) => call.query.get('force')),
      ).toEqual(['false', 'true']);
      expect(await screen.findByText('Proxy deleted')).toBeVisible();
    });

    it('asks in the words of the app when the refusal names no session', async () => {
      installFakeApi({
        'DELETE /proxies/:id': failure(409, 'proxy_in_use', 'x'),
      });
      const { user } = renderActions();

      await chooseFromMenu(user, 'Delete');
      await user.click(
        await screen.findByRole('button', { name: 'Delete proxy' }),
      );

      expect(
        await screen.findByText(
          'A session uses this proxy. If you delete the proxy, the session gets another one on its next start.',
        ),
      ).toBeVisible();
    });
  });

  describe('a proxy a running session has', () => {
    it('says to stop the session first, with a way to it, before anything is asked of the server', async () => {
      const api = installFakeApi({});
      const { user } = renderActions(proxy({ id: 4, session: running }));

      await chooseFromMenu(user, 'Delete');

      expect(
        await screen.findByRole('dialog', { name: 'Stop the session first' }),
      ).toBeVisible();
      expect(
        screen.getByRole('link', { name: 'Open session' }),
      ).toHaveAttribute('href', '/sessions/7');
      expect(
        screen.queryByRole('button', { name: 'Delete proxy' }),
      ).not.toBeInTheDocument();
      expect(api.calls).toHaveLength(0);
    });

    it('says so too when the session started after the table was read', async () => {
      installFakeApi({
        'DELETE /proxies/:id': failure(409, 'proxy_busy', 'x', {
          session: running,
        }),
      });
      const { user } = renderActions();

      await chooseFromMenu(user, 'Delete');
      await user.click(
        await screen.findByRole('button', { name: 'Delete proxy' }),
      );

      expect(
        await screen.findByRole('dialog', { name: 'Stop the session first' }),
      ).toBeVisible();
      expect(
        screen.getByRole('link', { name: 'Open session' }),
      ).toHaveAttribute('href', '/sessions/7');
      expect(
        screen.queryByText("Couldn't delete the proxy"),
      ).not.toBeInTheDocument();
    });

    it('forgets what the server said when the dialog is closed and opened again', async () => {
      installFakeApi({
        'DELETE /proxies/:id': failure(409, 'proxy_busy', 'x', {
          session: running,
        }),
      });
      const { user } = renderActions();
      await chooseFromMenu(user, 'Delete');
      await user.click(
        await screen.findByRole('button', { name: 'Delete proxy' }),
      );
      await screen.findByRole('dialog', { name: 'Stop the session first' });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      await chooseFromMenu(user, 'Delete');

      expect(
        await screen.findByRole('dialog', { name: 'Delete proxy?' }),
      ).toBeVisible();
    });
  });

  describe('when the deletion fails', () => {
    it('tells it once, as a toast, and keeps the question for another try', async () => {
      installFakeApi({
        'DELETE /proxies/:id': failure(404, 'proxy_not_found'),
      });
      const { user } = renderActions();

      await chooseFromMenu(user, 'Delete');
      await user.click(
        await screen.findByRole('button', { name: 'Delete proxy' }),
      );

      expect(
        await screen.findByText("Couldn't delete the proxy"),
      ).toBeVisible();
      expect(screen.getByText('This proxy no longer exists.')).toBeVisible();
      expect(screen.getAllByText("Couldn't delete the proxy")).toHaveLength(1);
      expect(
        screen.getByRole('dialog', { name: 'Delete proxy?' }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Delete proxy' }),
      ).toBeEnabled();
    });

    it('cannot be dismissed while the proxy is deleted', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      installFakeApi({
        'DELETE /proxies/:id': async () => {
          await gate;
          return undefined;
        },
      });
      const { user } = renderActions();

      await chooseFromMenu(user, 'Delete');
      await user.click(
        await screen.findByRole('button', { name: 'Delete proxy' }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Delete proxy' }),
        ).toHaveAttribute('aria-busy', 'true'),
      );

      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog')).toBeVisible();

      release();
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });
  });
});
