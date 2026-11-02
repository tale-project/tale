import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure } from '@/tests/utils/fake-api';
import { PageFrame, renderRouter, standIn } from '@/tests/utils/route-page';
import { installSecretsApi, summaryOf } from '@/tests/utils/secrets-api';
import {
  chipOf,
  chooseFilter,
  closeFilterPanel,
  filterButton,
} from '@/tests/utils/secrets-held-table';
import { openToastLines, ToastProbe } from '@/tests/utils/toast-probe';

import { validateSecretsSearch } from '../lib/filters';
import { SecretsPage } from './secrets-page';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

/**
 * The page on a real router, as the app mounts it: its route (with the
 * `validateSearch` of the filters), the frame that gives it its header slot and
 * its `main`, and a session page for its links to go to. A test starts at an
 * address and reads the address again after what the person did.
 */
function renderPage(
  options: Parameters<typeof installSecretsApi>[0] = {},
  address = '/secrets',
  configure?: (backend: ReturnType<typeof installSecretsApi>) => void,
) {
  const backend = installSecretsApi(options);
  configure?.(backend);
  const root = createRootRoute({
    component: () => (
      <PageFrame>
        <ToastProbe />
      </PageFrame>
    ),
  });
  const secrets = createRoute({
    getParentRoute: () => root,
    path: '/secrets',
    validateSearch: validateSecretsSearch,
    component: SecretsPage,
  });
  const view = renderRouter(
    root.addChildren([
      secrets,
      standIn(root, '/sessions/$sessionId', 'The page of a session'),
    ]),
    address,
  );
  return { ...view, ...backend };
}

/** The title of each row of the table, in order. */
function titles(): string[] {
  const table = screen.getByRole('table', { name: 'Secrets' });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('button')[0]?.textContent ?? '');
}

describe('the Secrets page', () => {
  it('is headed by the name of the section, above the collection', async () => {
    renderPage();

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Secrets',
    });
    expect(heading).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const table = await screen.findByRole('table', { name: 'Secrets' });
    expect(
      heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(await screen.findByText('Showing all 6 secrets')).toBeVisible();
  });

  it('keeps the collection in the main area of the page, as one region', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Secrets' });

    const region = screen.getByRole('region', { name: 'Secrets' });
    expect(within(screen.getByRole('main')).getByRole('region')).toBe(region);
    expect(within(region).getByRole('table')).toBeInTheDocument();
  });

  it('adds a secret from the page and lists it', async () => {
    const { user, api } = renderPage();
    await screen.findByRole('table', { name: 'Secrets' });

    await user.click(screen.getByRole('button', { name: 'Add secret' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Title' }),
      'Library card',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Website' }),
      'library.example.org',
    );
    const submit = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Add secret',
    });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.callsTo('POST /secrets')).toHaveLength(1);
    expect(
      await screen.findByRole('button', { name: 'Library card' }),
    ).toBeInTheDocument();
    expect(openToastLines()).toEqual([
      expect.stringMatching(/^success: Secret added/),
    ]);
  });

  it('says why it is empty, and offers the one way out of it', async () => {
    renderPage({ secrets: [] });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No secrets yet' }),
    ).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Add secret' })).toHaveLength(
      1,
    );
  });

  it('says it could not be read, under its heading, and reads again on request', async () => {
    const { user, api, state } = renderPage({}, '/secrets', ({ api: fake }) =>
      fake.on('GET /secrets', failure(500, 'internal')),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the secrets.",
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Secrets' }),
    ).toBeVisible();

    api.on('GET /secrets', () => state.secrets.map(summaryOf));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: 'Example shop' }),
    ).toBeInTheDocument();
  });

  it('is in German for a German reader', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Secrets' }),
    ).toBeVisible();
    expect(
      await screen.findByRole('columnheader', { name: 'Titel' }),
    ).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Secrets suchen' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Secret hinzufügen' }),
    ).toBeVisible();
  });

  it('has no accessibility violations, with secrets and without', async () => {
    const first = renderPage();
    await screen.findByRole('table', { name: 'Secrets' });
    await checkAccessibility(first);
    first.unmount();

    const second = renderPage({ secrets: [] });
    await screen.findByRole('heading', { name: 'No secrets yet' });
    await checkAccessibility(second);
  });
});

describe('the filters in the address of the page', () => {
  it('shows the whole list at /secrets, with no filter in force', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Example shop' });
    expect(titles()).toHaveLength(6);
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('opens narrowed to what the address says, and says so with a chip for each', async () => {
    renderPage({}, '/secrets?type=credentials&scope=3');

    expect(
      await screen.findByRole('button', { name: 'Mail' }),
    ).toBeInTheDocument();
    expect(titles()).toEqual(['Mail']);
    expect(chipOf('Type: Credentials')).toBeInTheDocument();
    expect(chipOf('Available to: Session "0003"')).toBeInTheDocument();
  });

  it('opens narrowed to the secrets for every session at ?scope=global', async () => {
    renderPage({}, '/secrets?scope=global');
    await screen.findByRole('button', { name: 'Example shop' });
    expect(titles()).toEqual([
      'Wi-Fi at the office',
      'Example shop',
      'My details',
    ]);
    expect(chipOf('Available to: Every session')).toBeInTheDocument();
  });

  it('writes the type in the address when it is chosen, as a plain address', async () => {
    const { user, router } = renderPage();
    await screen.findByRole('button', { name: 'Example shop' });

    await chooseFilter(user, 'Type', 'Note');

    await waitFor(() =>
      expect(router.state.location.href).toBe('/secrets?type=note'),
    );
    expect(titles()).toEqual(['Wi-Fi at the office']);
  });

  it('writes a session in the address by its number, as a number', async () => {
    const { user, router } = renderPage();
    await screen.findByRole('button', { name: 'Example shop' });

    await chooseFilter(user, 'Available to', 'Session "0003"');
    await waitFor(() =>
      expect(router.state.location.href).toBe('/secrets?scope=3'),
    );

    await chooseFilter(user, 'Available to', 'Every session');
    await waitFor(() =>
      expect(router.state.location.href).toBe('/secrets?scope=global'),
    );
  });

  it('writes both, and nothing for what shows everything', async () => {
    const { user, router } = renderPage();
    await screen.findByRole('button', { name: 'Example shop' });

    await chooseFilter(user, 'Type', 'Credentials');
    await chooseFilter(user, 'Available to', 'Session "0003"');
    await waitFor(() =>
      expect(router.state.location.href).toBe(
        '/secrets?type=credentials&scope=3',
      ),
    );

    await chooseFilter(user, 'Type', 'All');
    await waitFor(() =>
      expect(router.state.location.href).toBe('/secrets?scope=3'),
    );
    await chooseFilter(user, 'Available to', 'All secrets');
    await waitFor(() => expect(router.state.location.href).toBe('/secrets'));
  });

  it('lifts every filter from the address with the chips, one by one', async () => {
    const { user, router } = renderPage(
      {},
      '/secrets?type=credentials&scope=3',
    );
    await screen.findByRole('button', { name: 'Mail' });

    await user.click(chipOf('Type: Credentials'));
    await waitFor(() =>
      expect(router.state.location.href).toBe('/secrets?scope=3'),
    );
    await user.click(chipOf('Available to: Session "0003"'));
    await waitFor(() => expect(router.state.location.href).toBe('/secrets'));
    expect(titles()).toHaveLength(6);
  });

  it('lifts both at once with Clear all: neither comes back', async () => {
    const { user, router } = renderPage(
      {},
      '/secrets?type=credentials&scope=3',
    );
    await screen.findByRole('button', { name: 'Mail' });

    await user.click(filterButton());
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    await user.click(within(panel).getByRole('button', { name: 'Clear all' }));

    await waitFor(() => expect(router.state.location.href).toBe('/secrets'));
    await waitFor(() => expect(titles()).toHaveLength(6));
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('keeps the view through a reload: the address is all it needs', async () => {
    const first = renderPage();
    await screen.findByRole('button', { name: 'Example shop' });
    await chooseFilter(first.user, 'Type', 'Credit card');
    await waitFor(() =>
      expect(first.router.state.location.href).toBe('/secrets?type=card'),
    );
    const address = first.router.state.location.href;
    first.unmount();

    renderPage({}, address);
    expect(
      await screen.findByRole('button', { name: 'Visa ending 4242' }),
    ).toBeInTheDocument();
    expect(titles()).toEqual(['Visa ending 4242']);
    expect(chipOf('Type: Credit card')).toBeInTheDocument();
  });

  it('keeps the view when the way back from a session leads here', async () => {
    const { user, router } = renderPage({}, '/secrets?scope=3');
    const [link] = await screen.findAllByRole('link', { name: '0003' });
    await user.click(link);
    expect(await screen.findByText('The page of a session')).toBeVisible();
    expect(router.state.location.pathname).toBe('/sessions/3');

    router.history.back();

    expect(
      await screen.findByRole('button', { name: 'Visa ending 4242' }),
    ).toBeInTheDocument();
    expect(router.state.location.href).toBe('/secrets?scope=3');
    expect(titles()).toEqual(['Visa ending 4242', 'Mail']);
  });

  it('replaces the address as the filters change: the back button leaves the page, it does not step through them', async () => {
    const { user, router } = renderPage();
    await screen.findByRole('button', { name: 'Example shop' });
    expect(router.history.canGoBack()).toBe(false);

    await chooseFilter(user, 'Type', 'Note');
    await chooseFilter(user, 'Available to', 'Every session');
    await closeFilterPanel(user);
    await user.click(chipOf('Type: Note'));
    await waitFor(() =>
      expect(router.state.location.href).toBe('/secrets?scope=global'),
    );

    expect(router.history.canGoBack()).toBe(false);
  });

  it('reads no more than the one list: the filters are applied here, not asked of the server', async () => {
    const { user, api } = renderPage();
    await screen.findByRole('button', { name: 'Example shop' });

    await chooseFilter(user, 'Type', 'Note');
    await chooseFilter(user, 'Available to', 'Every session');

    expect(titles()).toEqual(['Wi-Fi at the office']);
    expect(api.callsTo('GET /secrets')).toHaveLength(1);
  });

  it('ignores what it does not understand, and shows the whole list', async () => {
    renderPage({}, '/secrets?type=passwords&scope=abc&page=3');
    await screen.findByRole('button', { name: 'Example shop' });
    expect(titles()).toHaveLength(6);
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('starts a new secret as the type and for the session the address names', async () => {
    const { user } = renderPage({}, '/secrets?type=card&scope=3');
    await screen.findByRole('button', { name: 'Visa ending 4242' });

    await user.click(screen.getByRole('button', { name: 'Add secret' }));

    expect(
      await screen.findByRole('combobox', { name: 'Type' }),
    ).toHaveTextContent('Credit card');
    expect(
      await screen.findByRole('button', { name: /^Available to/ }),
    ).toHaveTextContent('Session "0003"');
  });

  it('opens with the search box filled with what the address says, and the list narrowed by it', async () => {
    renderPage({}, '/secrets?q=shop');
    expect(
      await screen.findByRole('textbox', { name: 'Search secrets' }),
    ).toHaveValue('shop');
    // "Bank" is for the session "Shop EU": the search finds what a row says.
    await waitFor(() => expect(titles()).toEqual(['Example shop', 'Bank']));
  });

  it('writes what is typed in the search box to the address, after a pause, in one go', async () => {
    const { user, router } = renderPage();
    await screen.findByRole('button', { name: 'Example shop' });

    await user.click(screen.getByRole('textbox', { name: 'Search secrets' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Search secrets' }),
      'bank',
    );

    await waitFor(() =>
      expect(router.state.location.href).toBe('/secrets?q=bank'),
    );
    expect(titles()).toEqual(['Bank']);
    expect(router.history.canGoBack()).toBe(false);
  });

  it('keeps the filters when a search is typed, and the search when a filter is chosen', async () => {
    const { user, router } = renderPage({}, '/secrets?type=credentials');
    await screen.findByRole('button', { name: 'Mail' });

    await user.click(screen.getByRole('textbox', { name: 'Search secrets' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Search secrets' }),
      'mail',
    );
    await waitFor(() =>
      expect(router.state.location.href).toBe(
        '/secrets?type=credentials&q=mail',
      ),
    );

    await chooseFilter(user, 'Available to', 'Session "0003"');
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        type: 'credentials',
        scope: 3,
        q: 'mail',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Search secrets' })).toHaveValue(
      'mail',
    );
  });

  it('drops the search from the address when the box is emptied', async () => {
    const { user, router } = renderPage({}, '/secrets?q=bank');
    const box = await screen.findByRole('textbox', { name: 'Search secrets' });
    await waitFor(() => expect(titles()).toEqual(['Bank']));

    // The box is read-only until it has the focus (against autofill).
    await user.click(box);
    await user.clear(box);

    await waitFor(() => expect(router.state.location.href).toBe('/secrets'));
    await waitFor(() => expect(titles()).toHaveLength(6));
  });

  it('lifts the search, with the filters, with Clear filters', async () => {
    const { user, router } = renderPage({}, '/secrets?type=credentials&q=mail');
    await screen.findByRole('button', { name: 'Mail' });

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => expect(router.state.location.href).toBe('/secrets'));
    expect(screen.getByRole('textbox', { name: 'Search secrets' })).toHaveValue(
      '',
    );
    await waitFor(() => expect(titles()).toHaveLength(6));
  });

  it('keeps a search that looks like a number the way it was typed', async () => {
    const { user, router } = renderPage();
    await screen.findByRole('button', { name: 'Example shop' });
    await user.click(screen.getByRole('textbox', { name: 'Search secrets' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Search secrets' }),
      '4242',
    );
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ q: '4242' }),
    );
    const address = router.state.location.href;
    await waitFor(() => expect(titles()).toEqual(['Visa ending 4242']));

    renderPage({}, address);
    const boxes = await screen.findAllByRole('textbox', {
      name: 'Search secrets',
    });
    expect(boxes.at(-1)).toHaveValue('4242');
  });

  it('follows a link to the page with another search', async () => {
    const { router } = renderPage({}, '/secrets?q=shop');
    await screen.findByRole('textbox', { name: 'Search secrets' });

    await act(() => router.navigate({ to: '/secrets', search: { q: 'bank' } }));

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Search secrets' }),
      ).toHaveValue('bank'),
    );
    await waitFor(() => expect(titles()).toEqual(['Bank']));
  });

  it('has no accessibility violations with filters in force', async () => {
    const view = renderPage({}, '/secrets?type=credentials&scope=3');
    await screen.findByRole('button', { name: 'Mail' });
    await checkAccessibility(view);
  });
});
