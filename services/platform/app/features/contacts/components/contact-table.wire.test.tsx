/**
 * The Contacts list over its real paginated read: `useListContactsPaginated`,
 * the adapter row and `backendFetch` run unchanged, and only `fetch` is
 * answered here, by a small model of the contacts door that narrows by the
 * facets its address names. The router, the abilities and the column config
 * are stubbed as in `contact-table.test.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  defaultParseSearch,
  defaultStringifySearch,
} from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { i18n } from '@/lib/i18n/i18n';
import { CONTACT_SOURCES } from '@/lib/shared/contact-sources';
import { render, screen, waitFor, within } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { getContactSourceLabel } from '../lib/contact-data';
import { ContactsTable } from './contact-table';

const { navigate } = vi.hoisted(() => ({
  navigate:
    vi.fn<
      (args: {
        to: string;
        params: { id: string };
        search: (
          prev: Record<string, string>,
        ) => Record<string, string | undefined>;
      }) => void
    >(),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
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
  wireContact('API en', 'en', 'api_import'),
  wireContact('Conversation en', 'en', 'conversation'),
  wireContact('Shopify en', 'en', 'shopify'),
  wireContact('Webhook en', 'en', 'webhook'),
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
  // The adapters resolve the active organization from the page's address.
  window.history.pushState({}, '', `/dashboard/${ORG}/contacts`);
  navigate.mockReset();
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
    user: view.user,
    unmount: view.unmount,
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

describe('the Contacts facets over the real list read', () => {
  it('offers the complete supported Source catalog with the existing labels', async () => {
    const { user } = renderTable();
    await waitFor(() => expect(listedNames()).toHaveLength(directory.length));
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(screen.getByRole('button', { name: 'Source' }));
    expect(screen.getAllByRole('radio')).toHaveLength(CONTACT_SOURCES.length);
    for (const source of CONTACT_SOURCES) {
      const label = getContactSourceLabel(
        source,
        (key) => i18n.t(key, { ns: 'contacts' }),
        source,
      );
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it.each([
    ['shopify', 'Shopify', 'Shopify en'],
    ['webhook', 'Webhook', 'Webhook en'],
    ['manual_import', 'Manual', 'Audit en'],
    ['file_upload', 'Upload', 'Upload en'],
    ['api_import', 'API', 'API en'],
    ['conversation', 'Conversation', 'Conversation en'],
  ])(
    'selects %s and restores its filtered rows from the URL',
    async (source, label, name) => {
      const view = renderTable({ locale: 'en' });
      await waitFor(() => expect(listedNames()).toContain(name));
      await view.user.click(screen.getByRole('button', { name: 'Filter' }));
      await view.user.click(screen.getByRole('button', { name: 'Source' }));
      await view.user.click(screen.getByRole('radio', { name: label }));
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '/dashboard/$id/contacts',
          params: { id: ORG },
          search: expect.any(Function),
        }),
      );
      const navigation = navigate.mock.lastCall?.[0];
      if (!navigation) throw new Error('Expected source navigation');
      const nextSearch = navigation.search({ locale: 'en', query: 'kept' });
      expect(nextSearch).toEqual({ locale: 'en', query: 'kept', source });
      const url = `/dashboard/${ORG}/contacts${defaultStringifySearch(nextSearch)}`;
      window.history.pushState({}, '', url);
      const restored = z
        .object({ source: z.string(), locale: z.string() })
        .parse(defaultParseSearch(window.location.search));
      expect(restored.source).toBe(source);
      view.unmount();
      renderTable({
        source: restored.source,
        locale: restored.locale,
      });
      await waitFor(() => expect(listedNames()).toEqual([name]));
      expect(listReads().at(-1)).toBe(
        `GET /api/app/contacts?limit=20&source=${source}&locale=en&orgId=${ORG}`,
      );
    },
  );

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
    await waitFor(() => expect(listedNames()).toHaveLength(directory.length));

    view.rerender({ locale: 'fr' });
    await waitFor(() =>
      expect(listedNames()).toEqual(['Audit fr', 'Audit fr-CH']),
    );

    view.rerender({});
    await waitFor(() => expect(listedNames()).toHaveLength(directory.length));
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
