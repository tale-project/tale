import type { ColumnDef } from '@tanstack/react-table';
import { vi } from 'vitest';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { describeListReadFailure } from '@/tests/utils/list-read-failure';

import { WebsitesTable } from './websites-table';

// #3843: a Websites list whose read failed said "No websites yet", with no
// retry. The read lane runs for real; only `fetch` is answered.

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/mutations', () => ({
  useDeleteWebsite: () => ({ mutateAsync: vi.fn() }),
  useSyncWebsiteStatuses: () => ({ mutate: vi.fn() }),
}));
vi.mock('./websites-action-menu', () => ({
  WebsitesActionMenu: () => null,
}));
// The notice reads the search readiness through its own door.
vi.mock('./website-search-notice', () => ({
  WebsiteSearchNotice: () => null,
}));

const columns: ColumnDef<WebsiteDoc>[] = [
  { accessorKey: 'domain', header: 'Domain', size: 200 },
];

vi.mock('../hooks/use-websites-table-config', () => ({
  useWebsitesTableConfig: () => ({
    columns,
    searchPlaceholder: 'Search websites',
    pageSize: 20,
  }),
}));

const website = {
  id: 'website-docs',
  organizationId: 'org-1',
  domain: 'docs.synthetic.test',
  title: null,
  description: null,
  status: 'active',
  scanInterval: '1d',
  createdAt: 1770000000000,
  updatedAt: 1770000000000,
};

describeListReadFailure('WebsitesTable', {
  namespace: 'websites',
  emptyTitleKey: 'websites.title',
  path: '/dashboard/org-1/websites',
  firstPage: /^GET \/api\/app\/websites\?limit=20&orgId=org-1$/,
  anyPage: /^GET \/api\/app\/websites\?limit=/,
  rows: () =>
    Response.json({ page: [website], isDone: true, continueCursor: '' }),
  empty: () => Response.json({ page: [], isDone: true, continueCursor: '' }),
  rowText: website.domain,
  routes: (backend) =>
    backend.on(/^GET \/api\/app\/websites\/count\?/, () =>
      Response.json({ count: 1 }),
    ),
  render: () => <WebsitesTable organizationId="org-1" />,
});
