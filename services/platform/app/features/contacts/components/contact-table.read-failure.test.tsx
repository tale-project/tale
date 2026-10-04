import type { ColumnDef } from '@tanstack/react-table';
import { vi } from 'vitest';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { describeListReadFailure } from '@/tests/utils/list-read-failure';

import { ContactsTable } from './contact-table';

// #3843: a Contacts list whose read failed said "No contacts yet", with no
// retry. The read lane runs for real; only `fetch` is answered.

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('../hooks/mutations', () => ({
  useDeleteContact: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./contacts-action-menu', () => ({
  ContactsActionMenu: () => null,
}));

const columns: ColumnDef<ContactDoc>[] = [
  { accessorKey: 'name', header: 'Name', size: 200 },
];

vi.mock('../hooks/use-contacts-table-config', () => ({
  useContactsTableConfig: () => ({
    columns,
    searchPlaceholder: 'Search contacts',
    pageSize: 20,
  }),
}));

const contact = {
  id: 'contact-ada',
  organizationId: 'org-1',
  name: 'Synthetic contact Ada',
  email: 'ada@example.test',
  phone: null,
  externalId: null,
  source: 'manual_import',
  locale: 'en',
  address: null,
  tags: [],
  metadata: null,
  notes: null,
  lifecycleStatus: null,
  createdAt: 1770000000000,
  updatedAt: 1770000000000,
};

describeListReadFailure('ContactsTable', {
  namespace: 'contacts',
  emptyTitleKey: 'contacts.title',
  path: '/dashboard/org-1/contacts',
  firstPage: /^GET \/api\/app\/contacts\?limit=20&orgId=org-1$/,
  anyPage: /^GET \/api\/app\/contacts\?limit=/,
  rows: () => Response.json({ items: [contact], nextCursor: null }),
  empty: () => Response.json({ items: [], nextCursor: null }),
  rowText: contact.name,
  routes: (backend) =>
    backend.on(/^GET \/api\/app\/contacts\/count\?/, () =>
      Response.json({ count: 1 }),
    ),
  render: () => <ContactsTable organizationId="org-1" />,
});
