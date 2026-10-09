/**
 * The Contacts list over its real paginated read: `useListContactsPaginated`,
 * the adapter row and `backendFetch` run unchanged, and only `fetch` is
 * answered here, by a small model of the contacts door that narrows by the
 * facets its address names. The router, the abilities and the column config
 * are stubbed as in `contact-table.test.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchResultTarget } from '@/app/components/layout/app-sidebar/sidebar-search-command';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { Route } from '@/app/routes/dashboard/$id/_knowledge/contacts';
import { render, screen, waitFor, within } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { ContactsTable } from './contact-table';

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate:
    vi.fn<
      (options: {
        search?:
          | Record<string, unknown>
          | ((previous: Record<string, unknown>) => Record<string, unknown>);
      }) => void
    >(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('../hooks/mutations', () => ({
  useBulkCreateContacts: () => ({ mutateAsync: vi.fn() }),
  useCreateContact: () => ({ mutateAsync: vi.fn() }),
  useDeleteContact: () => ({ mutateAsync: vi.fn() }),
  useUpdateContact: () => ({ mutateAsync: vi.fn() }),
}));

const columns: ColumnDef<ContactDoc>[] = [
  { accessorKey: 'name', header: 'Name', size: 200 },
  { accessorKey: 'locale', header: 'Locale', size: 120 },
];

vi.mock('../hooks/use-contacts-table-config', () => ({
  useContactsTableConfig: () => ({
    columns,
    searchPlaceholder: 'Search contacts',
    pageSize: 20,
  }),
}));

const ORG = 'org-1';

function wireContact(name: string, locale: string, source: string) {
  return {
    id: `contact-${name.toLowerCase().replaceAll(' ', '-')}`,
    organizationId: ORG,
    name,
    email: `${name.toLowerCase().replaceAll(' ', '.')}@example.test`,
    phone: null,
    externalId: null,
    source,
    locale,
    address: null,
    tags: [],
    metadata: null,
    notes: null,
    lifecycleStatus: null,
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
  };
}

const directory = [
  wireContact('Audit en', 'en', 'manual_import'),
  wireContact('Audit fr', 'fr', 'manual_import'),
  wireContact('Audit fr-CH', 'fr-CH', 'manual_import'),
  wireContact('Upload en', 'en', 'file_upload'),
];

/** The contacts door as the list reaches it: each facet its address names
 * narrows the rows, a language listing its regional tags. */
function contactsDoor(url: URL): Response {
  const source = url.searchParams.get('source');
  const locale = url.searchParams.get('locale')?.toLowerCase();
  const items = directory.filter(
    (row) =>
      (source === null || row.source === source) &&
      (locale === undefined ||
        row.locale.toLowerCase() === locale ||
        row.locale.toLowerCase().startsWith(`${locale}-`)),
  );
  return Response.json({ items, nextCursor: null });
}

let backend: SyntheticBackend;

beforeEach(() => {
  mockNavigate.mockClear();
  // The adapters resolve the active organization from the page's address.
  window.history.pushState({}, '', `/dashboard/${ORG}/contacts`);
  backend = syntheticBackend();
  backend.on(/^GET \/api\/app\/contacts\/count\?/, () =>
    Response.json({ count: directory.length }),
  );
  backend.on(/^GET \/api\/app\/contacts\?/, contactsDoor);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function contactsTable(props: { source?: string; locale?: string }) {
  return <ContactsTable organizationId={ORG} {...props} />;
}

function renderTable(props: { source?: string; locale?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      {contactsTable(props)}
    </QueryClientProvider>,
  );
  return {
    rerender: (next: { source?: string; locale?: string }) =>
      view.rerender(
        <QueryClientProvider client={client}>
          {contactsTable(next)}
        </QueryClientProvider>,
      ),
  };
}

/** The names of the data rows the table renders, in order: each row's first
 * cell with text (the selection checkbox has none, Name precedes Locale). */
function listedNames(): string[] {
  return screen
    .getAllByRole('row')
    .map((row) =>
      within(row)
        .queryAllByRole('cell')
        .map((cell) => cell.textContent?.trim() ?? '')
        .find((text) => text !== ''),
    )
    .filter((name): name is string => name !== undefined);
}

const listReads = () =>
  backend.calls.filter((call) => call.startsWith('GET /api/app/contacts?'));

describe('the contact palette destination', () => {
  it('preserves a palette query and finds its contact outside the unfiltered first page', async () => {
    const target = searchResultTarget(
      { id: 'contact-audit-fr', title: 'Audit fr', data: { kind: 'contact' } },
      ORG,
      { taskView: 'board', allProjects: false },
    );
    expect(target.to).toBe('/dashboard/$id/contacts');
    if (!target.search || !('query' in target.search)) {
      throw new Error('Contact palette target must carry a query');
    }
    const routeSearch = vi
      .spyOn(Route, 'useSearch')
      .mockReturnValue(target.search);
    vi.spyOn(Route, 'useParams').mockReturnValue({ id: ORG });
    backend.on(/^GET \/api\/app\/contacts\?/, (url) => {
      const search = url.searchParams.get('search')?.toLowerCase();
      if (search) {
        const items = [directory[0], directory[1], directory[3]].filter((row) =>
          row.name.toLowerCase().includes(search),
        );
        return Response.json({ items, nextCursor: null });
      }
      return Response.json(
        url.searchParams.has('cursorId')
          ? { items: [directory[1]], nextCursor: null }
          : {
              items: [directory[0], directory[3]],
              nextCursor: { updatedAt: 1770000000000, id: 'contact-upload-en' },
            },
      );
    });
    const ContactsPage = Route.options.component!;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const page = () => (
      <QueryClientProvider client={client}>
        <ContactsPage />
      </QueryClientProvider>
    );
    const { user, rerender } = render(page());

    await waitFor(() => expect(listedNames()).toEqual(['Audit fr']), {
      timeout: 10_000,
    });
    expect(screen.getByPlaceholderText('Search contacts')).toHaveValue(
      'Audit fr',
    );
    expect(listReads()).toEqual([
      `GET /api/app/contacts?limit=20&search=Audit%20fr&orgId=${ORG}`,
    ]);

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search contacts')).toBeEnabled(),
    );
    await user.click(screen.getByPlaceholderText('Search contacts'));
    await user.clear(screen.getByPlaceholderText('Search contacts'));
    await waitFor(() =>
      expect(listedNames()).toEqual(['Audit en', 'Upload en']),
    );
    const clearedNavigation = mockNavigate.mock.calls.at(-1)?.[0];
    if (typeof clearedNavigation?.search !== 'function') {
      throw new Error('Clearing search must update its URL query');
    }
    expect(
      clearedNavigation.search({ query: 'Audit fr', locale: 'fr' }),
    ).toEqual({
      query: undefined,
      locale: 'fr',
    });
    expect(mockNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ replace: true }),
    );
    routeSearch.mockReturnValue({});
    rerender(page());
    routeSearch.mockReturnValue(target.search);
    rerender(page());
    await waitFor(() => expect(listedNames()).toEqual(['Audit fr']));
    expect(screen.getByPlaceholderText('Search contacts')).toHaveValue(
      'Audit fr',
    );
    await user.click(screen.getByPlaceholderText('Search contacts'));
    await user.clear(screen.getByPlaceholderText('Search contacts'));
    await user.type(screen.getByPlaceholderText('Search contacts'), 'upload');
    await waitFor(() => expect(listedNames()).toEqual(['Upload en']));

    routeSearch.mockReturnValue({ query: 'Audit en' });
    rerender(page());
    await waitFor(() => expect(listedNames()).toEqual(['Audit en']));
    expect(screen.getByPlaceholderText('Search contacts')).toHaveValue(
      'Audit en',
    );

    routeSearch.mockReturnValue({});
    rerender(page());
    await waitFor(() =>
      expect(listedNames()).toEqual(['Audit en', 'Upload en']),
    );
    expect(screen.getByPlaceholderText('Search contacts')).toHaveValue('');
  });
});

describe('the Contacts facets over the real list read', () => {
  // #3618: the Locale facet showed as active while the list asked for, cached
  // and rendered every contact.
  it('lists only the French contacts under the French Locale', async () => {
    renderTable({ locale: 'fr' });

    await waitFor(() =>
      expect(listedNames()).toEqual(['Audit fr', 'Audit fr-CH']),
    );
    expect(listReads()).toEqual([
      `GET /api/app/contacts?limit=20&locale=fr&orgId=${ORG}`,
    ]);
  });

  it('reads the list again when the Locale changes, and back', async () => {
    const view = renderTable();
    await waitFor(() => expect(listedNames()).toHaveLength(4));

    view.rerender({ locale: 'fr' });
    await waitFor(() =>
      expect(listedNames()).toEqual(['Audit fr', 'Audit fr-CH']),
    );

    view.rerender({});
    await waitFor(() => expect(listedNames()).toHaveLength(4));
    expect(listReads().slice(0, 2)).toEqual([
      `GET /api/app/contacts?limit=20&orgId=${ORG}`,
      `GET /api/app/contacts?limit=20&locale=fr&orgId=${ORG}`,
    ]);
  });

  it('still narrows by Source, alone and beside the Locale', async () => {
    const view = renderTable({ source: 'file_upload' });
    await waitFor(() => expect(listedNames()).toEqual(['Upload en']));

    view.rerender({ source: 'manual_import', locale: 'en' });
    await waitFor(() => expect(listedNames()).toEqual(['Audit en']));
    expect(listReads()).toEqual([
      `GET /api/app/contacts?limit=20&source=file_upload&orgId=${ORG}`,
      `GET /api/app/contacts?limit=20&source=manual_import&locale=en&orgId=${ORG}`,
    ]);
  });
});
