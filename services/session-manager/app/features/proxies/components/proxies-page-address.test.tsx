import { Toaster } from '@tale/ui/toaster';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Proxy } from '@/lib/api/schemas';
import { installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy, sessionRef } from '@/tests/utils/fixtures';
import { resetLanguage } from '@/tests/utils/language';
import { proxyPool } from '@/tests/utils/proxies-api';
import { PageFrame, renderRouter, standIn } from '@/tests/utils/route-page';

import { addressOf } from '../lib/address';
import { validateProxiesSearch } from '../lib/search';
import { ProxiesPage } from './proxies-page';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetLanguage();
});

/**
 * The Proxies page on a real router, as the app mounts it: its route (with the
 * `validateSearch` of the search box), the frame that gives it its header slot,
 * and a session page for its links to go to. A test starts at an address and
 * reads the address again after what the person did.
 */
function renderProxiesPage(address = '/proxies') {
  const root = createRootRoute({
    component: () => (
      <PageFrame>
        <Toaster />
      </PageFrame>
    ),
  });
  const proxies = createRoute({
    getParentRoute: () => root,
    path: '/proxies',
    validateSearch: validateProxiesSearch,
    component: ProxiesPage,
  });
  return renderRouter(
    root.addChildren([
      proxies,
      standIn(root, '/sessions/$sessionId', 'The page of a session'),
    ]),
    address,
  );
}

/** A proxy whose `display` agrees with its address, as the server's does. */
function member(overrides: Partial<Proxy> & Pick<Proxy, 'id'>): Proxy {
  const row = proxy({ host: `198.51.100.${overrides.id}`, ...overrides });
  return { ...row, display: addressOf(row) };
}

const POOL = [
  member({ id: 3 }),
  member({
    id: 2,
    session: sessionRef({ id: 8, name: 'shop', status: 'running' }),
  }),
  member({ id: 1 }),
];

function serve(rows: Proxy[] = POOL) {
  return installFakeApi({
    'GET /meta': () =>
      meta({ counts: { proxies: rows.length, freeProxies: rows.length } }),
    'GET /proxies': proxyPool(() => rows),
  });
}

const search = () => screen.getByRole('textbox', { name: 'Search proxies' });

/** The host and port of each row, in order. */
function shown(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) => /198\.51\.100\.\d:8080/.exec(row.textContent ?? '')?.[0] ?? '',
    );
}

describe('the search of the Proxies page, in its address', () => {
  it('is empty at /proxies, which shows every proxy', async () => {
    serve();
    renderProxiesPage();
    await screen.findByText('198.51.100.3:8080');
    expect(search()).toHaveValue('');
    expect(shown()).toHaveLength(3);
  });

  it('fills the search box from the address when the page opens, and narrows the list by it', async () => {
    serve();
    renderProxiesPage('/proxies?q=198.51.100.2');

    await screen.findByText('198.51.100.2:8080');
    expect(search()).toHaveValue('198.51.100.2');
    await waitFor(() => expect(shown()).toEqual(['198.51.100.2:8080']));
  });

  it('writes what is typed to the address after a pause, replacing the entry', async () => {
    serve();
    const { user, router } = renderProxiesPage();
    await screen.findByText('198.51.100.3:8080');

    await user.click(search());
    await user.type(search(), 'shop');

    await waitFor(() =>
      expect(router.state.location.href).toBe('/proxies?q=shop'),
    );
    expect(shown()).toEqual(['198.51.100.2:8080']);
    expect(router.history.canGoBack()).toBe(false);
  });

  it('drops the search from the address when the box is emptied', async () => {
    serve();
    const { user, router } = renderProxiesPage('/proxies?q=shop');
    await screen.findByText('198.51.100.2:8080');
    await user.click(search());
    await user.clear(search());

    await waitFor(() => expect(router.state.location.href).toBe('/proxies'));
    await waitFor(() => expect(shown()).toHaveLength(3));
  });

  it('keeps a search that looks like a number the way it was typed, through a reload', async () => {
    serve();
    const first = renderProxiesPage();
    await screen.findByText('198.51.100.3:8080');
    await first.user.click(search());
    await first.user.type(search(), '8080');
    await waitFor(() =>
      expect(first.router.state.location.search).toEqual({ q: '8080' }),
    );
    const address = first.router.state.location.href;
    first.unmount();

    serve();
    renderProxiesPage(address);
    await screen.findByText('198.51.100.3:8080');
    expect(search()).toHaveValue('8080');
  });

  it('follows a link to the page with another search', async () => {
    serve();
    const { router } = renderProxiesPage('/proxies?q=shop');
    await screen.findByText('198.51.100.2:8080');

    await act(() =>
      router.navigate({ to: '/proxies', search: { q: '198.51.100.1' } }),
    );

    await waitFor(() => expect(search()).toHaveValue('198.51.100.1'));
    await waitFor(() => expect(shown()).toEqual(['198.51.100.1:8080']));
  });

  it('keeps the view when the way back from a session leads here', async () => {
    serve();
    const { user, router } = renderProxiesPage('/proxies?q=shop');
    await user.click(await screen.findByRole('link', { name: 'shop' }));
    expect(await screen.findByText('The page of a session')).toBeVisible();

    router.history.back();

    await waitFor(() => expect(search()).toHaveValue('shop'));
    expect(router.state.location.href).toBe('/proxies?q=shop');
    expect(shown()).toEqual(['198.51.100.2:8080']);
  });

  it('ignores a search that is no text, and shows every proxy', async () => {
    serve();
    renderProxiesPage('/proxies?q=%7B%22a%22%3A1%7D');
    await screen.findByText('198.51.100.3:8080');
    expect(search()).toHaveValue('');
    expect(shown()).toHaveLength(3);
  });
});
