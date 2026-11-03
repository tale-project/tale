import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POLL_FAST_MS } from '@/app/lib/polling';
import { proxyCreateSchema, type Meta, type Proxy } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import {
  meta,
  proxy,
  proxyCheck,
  sessionRef,
  importResult,
  importDuplicate,
} from '@/tests/utils/fixtures';

import { addressOf } from '../lib/address';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/proxies');
});

import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { proxyPool } from '@/tests/utils/proxies-api';
import { renderInShell } from '@/tests/utils/render';

import { ProxiesPage } from './proxies-page';

afterEach(async () => {
  vi.useRealTimers();
  await resetLanguage();
});

function member(overrides: Partial<Proxy> & Pick<Proxy, 'id'>): Proxy {
  const row = proxy({ host: `198.51.100.${overrides.id}`, ...overrides });
  return { ...row, display: addressOf(row) };
}

const checking = () =>
  proxyCheck({ status: 'checking', ok: null, checkedAt: null });

/** The proxy with the result of another check. */
function withCheck(row: Proxy, check: Proxy['check']): Proxy {
  return { ...row, check };
}

function countsOf(rows: readonly Proxy[]): Partial<Meta['counts']> {
  return {
    proxies: rows.length,
    freeProxies: rows.filter(
      (row) =>
        row.session === null && row.check.ok !== false && row.sameIpAs === null,
    ).length,
    failedProxies: rows.filter((row) => row.check.ok === false).length,
    checkingProxies: rows.filter((row) => row.check.status === 'checking')
      .length,
  };
}

/**
 * A pool the test can change, behind the routes the page uses: what the
 * writes do is what the next read shows, as with the real server.
 */
function serve(initial: Proxy[]) {
  const state = { rows: initial };
  const api = installFakeApi({
    'GET /meta': () => meta({ counts: countsOf(state.rows) }),
    'GET /proxies': proxyPool(() => state.rows),
    'POST /proxies': ({ body }) => {
      const text = proxyCreateSchema.parse(body).proxy;
      const added = member({
        id: Math.max(0, ...state.rows.map((row) => row.id)) + 1,
        host: text.split(':')[0] ?? 'new.example.com',
        check: checking(),
      });
      state.rows = [added, ...state.rows];
      return added;
    },
    'POST /proxies/:id/check': ({ params }) => {
      const id = Number(params.id);
      state.rows = state.rows.map((row) =>
        row.id === id ? withCheck(row, checking()) : row,
      );
      return state.rows.find((row) => row.id === id);
    },
    'POST /proxies/check-all': () => {
      state.rows = state.rows.map((row) => withCheck(row, checking()));
      return state.rows;
    },
    'DELETE /proxies/:id': ({ params }) => {
      state.rows = state.rows.filter((row) => row.id !== Number(params.id));
      return undefined;
    },
  });
  return { api, state };
}

const POOL = [
  member({ id: 3 }),
  member({
    id: 2,
    session: sessionRef({ id: 8, name: 'work', status: 'stopped' }),
  }),
  member({
    id: 1,
    check: proxyCheck({ status: 'failed', ok: false, error: 'Refused' }),
  }),
];

/** The button of the table's create action, in the toolbar or in the empty state. */
const addButton = () => screen.getByRole('button', { name: 'Add proxy' });
const searchBox = () => screen.getByRole('textbox', { name: 'Search proxies' });

function rowOf(hostPort: string): HTMLElement {
  const row = screen.getByText(hostPort).closest('tr');
  if (row === null) throw new Error(`no row for ${hostPort}`);
  return row;
}

type User = ReturnType<typeof renderInShell>['user'];

async function chooseFromAddMenu(user: User, item: string) {
  await user.click(addButton());
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

describe('ProxiesPage', () => {
  describe('the page', () => {
    it('is one screen: a title, and a table that scrolls its own rows', async () => {
      serve(POOL);
      renderInShell(<ProxiesPage />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Proxies' }),
      ).toBeVisible();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(await screen.findByText('Showing all 3 proxies')).toBeVisible();
      expect(screen.getByTestId('data-table-scrollport')).toBeVisible();
      expect(screen.getByRole('region', { name: 'Proxy list' })).toBeVisible();
    });

    it('holds only its title in the header: the way to check every proxy is in the toolbar of the table', async () => {
      serve(POOL);
      renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      const header = screen.getByRole('heading', { level: 1 }).parentElement;
      if (header === null) throw new Error('the title has no header');
      expect(within(header).queryByRole('button')).not.toBeInTheDocument();
      expect(
        within(screen.getByRole('region', { name: 'Proxy list' })).getByRole(
          'button',
          { name: 'Check all proxies' },
        ),
      ).toBeVisible();
    });

    it('speaks German', async () => {
      await showLanguage('de');
      serve(POOL);
      renderInShell(<ProxiesPage />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Proxies' }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Alle Proxies prüfen' }),
      ).toBeVisible();
      expect(
        await screen.findByText('Alle 3 Proxies werden angezeigt'),
      ).toBeVisible();
    });

    it('has no accessibility violations', async () => {
      serve(POOL);
      const view = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      await checkAccessibility(view);
    });

    it('is reached in an order that follows the page: the search, the way to check and the way to add, the rows', async () => {
      serve(POOL);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Check all proxies' }),
        ).toBeEnabled(),
      );

      const order: string[] = [];
      for (let step = 0; step < 6; step += 1) {
        await user.tab();
        const focused = document.activeElement;
        order.push(
          focused?.getAttribute('aria-label') ??
            focused?.textContent?.trim() ??
            '',
        );
      }

      expect(order).toEqual([
        'Search proxies',
        'Check all proxies',
        'Add proxy',
        'Actions for 198.51.100.3:8080',
        'work',
        'Actions for 198.51.100.2:8080',
      ]);
    });
  });

  describe('adding a proxy', () => {
    it('adds it from the menu, which shows it at once as being checked', async () => {
      const { api } = serve(POOL);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      await chooseFromAddMenu(user, 'Manual entry');
      await user.type(
        await screen.findByRole('textbox', { name: 'Proxy' }),
        '198.51.100.9:8080',
      );
      await user.click(screen.getByRole('button', { name: 'Add proxy' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /proxies')).toHaveLength(1);
      expect(await screen.findByText('Showing all 4 proxies')).toBeVisible();
      expect(
        within(rowOf('198.51.100.9:8080')).getByText('Checking'),
      ).toBeVisible();
      expect(screen.getByText('Proxy added')).toBeVisible();
      // The summary counts it, and the focus is back on the button that asked.
      expect(
        screen.getByText('4 proxies · 2 free · 1 not working'),
      ).toBeVisible();
      expect(addButton()).toHaveFocus();
    });

    it('shows the proxy it added even while a search that would hide it is typed', async () => {
      serve(POOL);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');
      await user.click(searchBox());
      await user.type(searchBox(), '198.51.100.2');
      expect(await screen.findByText('Showing 1 of 3 proxies')).toBeVisible();

      await chooseFromAddMenu(user, 'Manual entry');
      await user.type(
        await screen.findByRole('textbox', { name: 'Proxy' }),
        '198.51.100.9:8080{Enter}',
      );

      // The new proxy is the first row of a list that is whole again.
      expect(await screen.findByText('Showing all 4 proxies')).toBeVisible();
      expect(searchBox()).toHaveValue('');
      expect(screen.getByText('198.51.100.9:8080')).toBeVisible();
    });

    it('can be reached and done from the keyboard', async () => {
      serve(POOL);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      addButton().focus();
      await user.keyboard('{Enter}');
      await screen.findByRole('menu');
      await user.keyboard('{Enter}');
      const field = await screen.findByRole('textbox', { name: 'Proxy' });
      expect(field).toHaveFocus();
      await user.keyboard('198.51.100.9:8080{Enter}');

      expect(await screen.findByText('Showing all 4 proxies')).toBeVisible();
    });

    it('opens the same dialog from the empty state, and gives the focus back to the toolbar once the first proxy is there', async () => {
      serve([]);
      const { user } = renderInShell(<ProxiesPage />);

      await screen.findByRole('heading', { name: 'No proxies yet' });
      // The create action of the empty state is the one of the toolbar, moved.
      await chooseFromAddMenu(user, 'Manual entry');
      await user.type(
        await screen.findByRole('textbox', { name: 'Proxy' }),
        '198.51.100.9:8080{Enter}',
      );

      expect(await screen.findByText('Showing all 1 proxy')).toBeVisible();
      await waitFor(() => expect(addButton()).toHaveFocus());
    });
  });

  describe('importing proxies', () => {
    it('imports a list from the menu and shows the report over the table', async () => {
      const { api, state } = serve(POOL);
      api.on('POST /proxies/import', () => {
        state.rows = [member({ id: 4, check: checking() }), ...state.rows];
        return importResult({
          added: [member({ id: 4 })],
          duplicates: [
            importDuplicate({ line: 2, display: 'http://198.51.100.2:8080' }),
          ],
        });
      });
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      await chooseFromAddMenu(user, 'Import a list');
      await user.click(
        await screen.findByRole('textbox', { name: 'Proxies, one per line' }),
      );
      await user.paste('198.51.100.4:8080\n198.51.100.2:8080');
      await user.click(screen.getByRole('button', { name: 'Import proxies' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        '1 proxy added, 1 duplicate',
      );
      // The table behind the report already has the new proxy.
      expect(await screen.findByText('Showing all 4 proxies')).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Done' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(addButton()).toHaveFocus();
    });

    it('shows what an import added even while a search that would hide it is typed, behind the report', async () => {
      const { api, state } = serve(POOL);
      api.on('POST /proxies/import', () => {
        state.rows = [member({ id: 4, check: checking() }), ...state.rows];
        return importResult({
          added: [member({ id: 4 })],
          duplicates: [
            importDuplicate({ line: 2, display: 'http://198.51.100.2:8080' }),
          ],
        });
      });
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');
      await user.click(searchBox());
      await user.type(searchBox(), '198.51.100.2');
      expect(await screen.findByText('Showing 1 of 3 proxies')).toBeVisible();

      await chooseFromAddMenu(user, 'Import a list');
      await user.click(
        await screen.findByRole('textbox', { name: 'Proxies, one per line' }),
      );
      await user.paste('198.51.100.4:8080\n198.51.100.2:8080');
      await user.click(screen.getByRole('button', { name: 'Import proxies' }));
      await screen.findByRole('status');
      await user.click(screen.getByRole('button', { name: 'Done' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(searchBox()).toHaveValue('');
      expect(await screen.findByText('Showing all 4 proxies')).toBeVisible();
      expect(screen.getByText('198.51.100.4:8080')).toBeVisible();
    });

    it('shows a duplicate in the table: the dialog closes and the search narrows to it', async () => {
      const { api } = serve(POOL);
      api.on('POST /proxies/import', () =>
        importResult({
          duplicates: [
            importDuplicate({
              line: 1,
              display: 'socks5://ada@198.51.100.2:8080',
            }),
          ],
        }),
      );
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      await chooseFromAddMenu(user, 'Import a list');
      await user.click(
        await screen.findByRole('textbox', { name: 'Proxies, one per line' }),
      );
      await user.paste('198.51.100.2:8080:ada:x');
      await user.click(screen.getByRole('button', { name: 'Import proxies' }));
      await user.click(
        await screen.findByText('1 duplicate', { selector: 'summary' }),
      );
      await user.click(screen.getByRole('button', { name: /^Show in list/ }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(searchBox()).toHaveValue('198.51.100.2:8080');
      expect(await screen.findByText('Showing 1 of 3 proxies')).toBeVisible();
      expect(screen.getByText('198.51.100.2:8080')).toBeVisible();
      expect(screen.queryByText('198.51.100.3:8080')).not.toBeInTheDocument();
    });
  });

  describe('checking', () => {
    it('checks one proxy: its row says so at once, and shows the result when the check is done', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { api, state } = serve(POOL);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 198.51.100.3:8080' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Check' }));

      expect(
        await within(rowOf('198.51.100.3:8080')).findByText('Checking'),
      ).toBeVisible();
      expect(api.callsTo('POST /proxies/:id/check')[0]?.params.id).toBe('3');
      expect(screen.getByText('Check started')).toBeVisible();

      // The check ends; the quick poll the check asked for brings the result.
      state.rows = state.rows.map((row) =>
        row.id === 3
          ? withCheck(
              row,
              proxyCheck({ exitIp: '203.0.113.99', latencyMs: 77 }),
            )
          : row,
      );
      await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

      const row = within(rowOf('198.51.100.3:8080'));
      expect(await row.findByText('Working')).toBeVisible();
      expect(row.getByText('203.0.113.99')).toBeVisible();
      expect(row.getByText('77 ms')).toBeVisible();
    });

    it('checks every proxy from the toolbar, and keeps asking while they are checked', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { api, state } = serve(POOL);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Check all proxies' }),
        ).toBeEnabled(),
      );

      await user.click(
        screen.getByRole('button', { name: 'Check all proxies' }),
      );

      await waitFor(() =>
        expect(screen.getAllByText('Checking')).toHaveLength(3),
      );
      expect(api.callsTo('POST /proxies/check-all')).toHaveLength(1);
      expect(screen.getByText('Check of all proxies started')).toBeVisible();
      // Every proxy is being checked: nothing more to start, said on focus.
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Check all proxies' }),
        ).toHaveAttribute('aria-disabled', 'true'),
      );
      expect(
        screen.getByRole('button', { name: 'Check all proxies' }),
      ).toHaveFocus();

      state.rows = state.rows.map((row) => withCheck(row, proxyCheck()));
      await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

      await waitFor(() =>
        expect(screen.getAllByText('Working')).toHaveLength(3),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Check all proxies' }),
        ).not.toHaveAttribute('aria-disabled'),
      );
    });

    it('tells a failed check once and leaves the rows as they were', async () => {
      const { api } = serve(POOL);
      api.on('POST /proxies/:id/check', failure(404, 'proxy_not_found'));
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 198.51.100.3:8080' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Check' }));

      expect(await screen.findByText("Couldn't check the proxy")).toBeVisible();
      expect(screen.getByText('This proxy no longer exists.')).toBeVisible();
      expect(screen.queryByText('Checking')).not.toBeInTheDocument();
    });
  });

  describe('deleting', () => {
    it('deletes a proxy: the row goes, the count follows, and the focus lands on the next row', async () => {
      const { api } = serve(POOL);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 198.51.100.3:8080' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      await user.click(
        await screen.findByRole('button', { name: 'Delete proxy' }),
      );

      expect(await screen.findByText('Showing all 2 proxies')).toBeVisible();
      expect(screen.queryByText('198.51.100.3:8080')).not.toBeInTheDocument();
      expect(api.callsTo('DELETE /proxies/:id')[0]?.query.get('force')).toBe(
        'false',
      );
      expect(screen.getByText('Proxy deleted')).toBeVisible();
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Actions for 198.51.100.2:8080' }),
        ).toHaveFocus(),
      );
    });

    it('deletes a proxy a stopped session has once the person agrees, and says what the session gets', async () => {
      const { api } = serve(POOL);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 3 proxies');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 198.51.100.2:8080' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      expect(
        await screen.findByText(
          'The session "work" uses 198.51.100.2:8080. If you delete the proxy, the session gets another one on its next start.',
        ),
      ).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Delete proxy' }));

      expect(await screen.findByText('Showing all 2 proxies')).toBeVisible();
      expect(api.callsTo('DELETE /proxies/:id')[0]?.query.get('force')).toBe(
        'true',
      );
    });

    it('leaves a proxy a running session has where it is, and says to stop the session', async () => {
      const running = member({
        id: 5,
        session: sessionRef({ id: 8, name: 'work', status: 'running' }),
      });
      const { api } = serve([running, ...POOL]);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 4 proxies');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 198.51.100.5:8080' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

      expect(
        await screen.findByRole('dialog', { name: 'Stop the session first' }),
      ).toBeVisible();
      expect(
        screen.getByRole('link', { name: 'Open session' }),
      ).toHaveAttribute('href', '/sessions/8');
      expect(api.callsTo('DELETE /proxies/:id')).toHaveLength(0);
      expect(screen.getByText('Showing all 4 proxies')).toBeVisible();
    });

    it('moves the focus to the add button when the last proxy goes', async () => {
      serve([member({ id: 1 })]);
      const { user } = renderInShell(<ProxiesPage />);
      await screen.findByText('Showing all 1 proxy');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 198.51.100.1:8080' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      await user.click(
        await screen.findByRole('button', { name: 'Delete proxy' }),
      );

      expect(await screen.findByText('No proxies yet')).toBeVisible();
      await waitFor(() => expect(addButton()).toHaveFocus());
    });
  });
});
