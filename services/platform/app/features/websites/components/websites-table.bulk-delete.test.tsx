import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { WebsitesTable } from './websites-table';

// Deleting a website takes `knowledgeWrite` (WEB-R1), so the bulk path offers
// it to the roles the row menu offers Delete to, as on Products, Contacts and
// Knowledge entries (#4841). A member used to get the checkboxes and
// **Delete selected**, and every delete was refused. These run the real
// column config, row menu, selection and bulk bar; only the backend hooks
// are stubbed.

let mockWebsites: WebsiteDoc[] = [];
let mockAbility = defineAbilityFor('editor');
const mockDelete = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => mockAbility,
}));

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateWebsite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWebsite: () => ({ mutateAsync: mockDelete }),
  useUpdateWebsite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResumeScanning: () => ({ mutate: vi.fn() }),
  useScanWebsiteNow: () => ({ mutate: vi.fn(), isPending: false }),
  // The table syncs the sites' statuses once as it mounts; that write answers.
  useSyncWebsiteStatuses: () => ({
    mutateAsync: () => Promise.resolve(),
    isPending: false,
  }),
}));

vi.mock('../hooks/queries', () => ({
  useApproxWebsiteCount: () => ({ data: mockWebsites.length }),
  useListWebsitesPaginated: () => ({
    results: mockWebsites,
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
    error: null,
    retry: vi.fn(),
    isRetrying: false,
    unavailable: false,
    errorCount: 0,
  }),
}));

// The notice reads the search readiness through its own door.
vi.mock('./website-search-notice', () => ({
  WebsiteSearchNotice: () => null,
}));

vi.mock('./websites-action-menu', () => ({
  WebsitesActionMenu: () => null,
}));

function makeWebsite(domain: string): WebsiteDoc {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the table reads id, domain, status and the page counts
  return {
    _id: `website-${domain}`,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    domain,
    status: 'active',
    scanInterval: '1d',
  } as unknown as WebsiteDoc;
}

/** The data row whose Website cell reads `domain`. */
function rowOf(domain: string): HTMLElement {
  const row = screen.getAllByRole('row').find((candidate) =>
    within(candidate)
      .queryAllByRole('cell')
      .some((cell) => cell.textContent?.includes(domain)),
  );
  if (!row) throw new Error(`no row for ${domain}`);
  return row;
}

async function menuLabelsOf(
  user: ReturnType<typeof render>['user'],
  domain: string,
): Promise<string[]> {
  await user.click(
    within(rowOf(domain)).getByRole('button', { name: 'Open menu' }),
  );
  const labels = (await screen.findAllByRole('menuitem')).map(
    (item) => item.textContent ?? '',
  );
  await user.keyboard('{Escape}');
  return labels;
}

beforeEach(() => {
  sessionStorage.clear();
  mockWebsites = [];
  mockAbility = defineAbilityFor('editor');
  mockDelete.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('WebsitesTable bulk delete', () => {
  it('gives a member View but no row Delete, checkbox or bulk bar', async () => {
    mockAbility = defineAbilityFor('member');
    mockWebsites = [makeWebsite('docs.synthetic.test')];
    const { user, container } = render(
      <WebsitesTable organizationId="org-1" />,
    );

    const labels = await menuLabelsOf(user, 'docs.synthetic.test');
    expect(labels).toContain('View');
    expect(labels).not.toContain('Delete');
    // Neither a row's **Select row** nor the header's **Select all**.
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(
      screen.queryByRole('button', { name: 'Delete selected' }),
    ).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
    await checkAccessibility(container, {
      rules: { 'aria-allowed-attr': { enabled: false } },
    });
  });

  it('keeps the checkbox and bulk Delete for an editor', async () => {
    mockWebsites = [makeWebsite('docs.synthetic.test')];
    const { user } = render(<WebsitesTable organizationId="org-1" />);

    expect(await menuLabelsOf(user, 'docs.synthetic.test')).toContain('Delete');
    const checkbox = within(rowOf('docs.synthetic.test')).getByRole(
      'checkbox',
      { name: 'Select row' },
    );
    checkbox.focus();
    await user.keyboard(' ');
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith({
        websiteId: 'website-docs.synthetic.test',
      }),
    );
  });

  it('removes a selected bulk workflow when the editor becomes a member', async () => {
    mockWebsites = [makeWebsite('docs.synthetic.test')];
    const { user, rerender } = render(<WebsitesTable organizationId="org-1" />);
    await user.click(screen.getByRole('checkbox', { name: 'Select row' }));
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    mockAbility = defineAbilityFor('member');
    rerender(<WebsitesTable organizationId="org-1" />);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(
      screen.queryByRole('button', { name: 'Delete selected' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
