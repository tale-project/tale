import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ContactsTable } from './contact-table';

// The bulk path must apply the rule the row menu applies to one contact (#3623):
// a writer, on a contact the organization owns. A synced contact belongs to its
// source, so its menu offers no Delete — and its checkbox must not offer one
// either. These run the real column config, row menu, selection and bulk bar;
// only the backend hooks are stubbed.

let mockContacts: ContactDoc[] = [];
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

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('../hooks/mutations', () => ({
  useBulkCreateContacts: () => ({ mutateAsync: vi.fn() }),
  useCreateContact: () => ({ mutateAsync: vi.fn() }),
  useDeleteContact: () => ({ mutateAsync: mockDelete }),
  useUpdateContact: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/queries', () => ({
  useApproxContactCount: () => ({ data: mockContacts.length }),
  useListContactsPaginated: () => ({
    results: mockContacts,
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

function makeContact(name: string, source: string): ContactDoc {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture: the table reads id, name, email and source
  return {
    _id: `contact-${name.toLowerCase()}`,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name,
    email: `${name.toLowerCase()}@example.test`,
    source,
    locale: 'en',
  } as unknown as ContactDoc;
}

/** The data row whose Name cell reads `name`. */
function rowOf(name: string): HTMLElement {
  const row = screen.getAllByRole('row').find((candidate) =>
    within(candidate)
      .queryAllByRole('cell')
      .some((cell) => cell.textContent?.trim() === name),
  );
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

function checkboxOf(name: string): HTMLElement | null {
  return within(rowOf(name)).queryByRole('checkbox', { name: 'Select row' });
}

async function menuLabelsOf(
  user: ReturnType<typeof render>['user'],
  name: string,
): Promise<string[]> {
  await user.click(
    within(rowOf(name)).getByRole('button', { name: 'Open menu' }),
  );
  const labels = (await screen.findAllByRole('menuitem')).map(
    (item) => item.textContent ?? '',
  );
  await user.keyboard('{Escape}');
  return labels;
}

async function deleteSelected(user: ReturnType<typeof render>['user']) {
  await user.click(screen.getByRole('button', { name: 'Delete selected' }));
  const confirm = await screen.findByRole('dialog');
  await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Delete selected' }),
    ).not.toBeInTheDocument(),
  );
}

beforeEach(() => {
  mockContacts = [];
  mockAbility = defineAbilityFor('editor');
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContactsTable bulk delete', () => {
  it('offers a synced contact neither Delete in its menu nor a checkbox', async () => {
    mockContacts = [
      makeContact('Synced', 'salesforce'),
      makeContact('Typed', 'manual_import'),
    ];
    const { user } = render(<ContactsTable organizationId="org-1" />);

    expect(await menuLabelsOf(user, 'Synced')).not.toContain('Delete');
    expect(checkboxOf('Synced')).toBeNull();

    // Control: the contact a person typed in keeps both ways to delete it.
    expect(await menuLabelsOf(user, 'Typed')).toContain('Delete');
    expect(checkboxOf('Typed')).toBeInTheDocument();
  });

  it('selects all and deletes only the contacts the row menu would delete', async () => {
    mockContacts = [
      makeContact('Synced', 'salesforce'),
      makeContact('Typed', 'manual_import'),
      makeContact('Uploaded', 'file_upload'),
      makeContact('Mirrored', 'conversation'),
    ];
    const { user } = render(<ContactsTable organizationId="org-1" />);

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText('2 items selected')).toBeInTheDocument();

    await deleteSelected(user);

    expect(mockDelete.mock.calls).toEqual([
      [{ contactId: 'contact-typed' }],
      [{ contactId: 'contact-uploaded' }],
    ]);
  });

  it('never deletes a selected contact once a sync owns it', async () => {
    mockContacts = [
      makeContact('Taken', 'manual_import'),
      makeContact('Typed', 'manual_import'),
    ];
    const { user, rerender } = render(<ContactsTable organizationId="org-1" />);
    await user.click(checkboxOf('Taken') as HTMLElement);
    expect(screen.getByText('1 item selected')).toBeInTheDocument();

    // A connector now owns the selected contact: its menu drops Delete, and
    // the selection it was already in drops it too.
    mockContacts = [
      makeContact('Taken', 'hubspot'),
      makeContact('Typed', 'manual_import'),
    ];
    rerender(<ContactsTable organizationId="org-1" />);
    expect(checkboxOf('Taken')).toBeNull();
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();

    await user.click(checkboxOf('Typed') as HTMLElement);
    expect(screen.getByText('1 item selected')).toBeInTheDocument();
    await deleteSelected(user);

    expect(mockDelete.mock.calls).toEqual([[{ contactId: 'contact-typed' }]]);
  });

  it('gives a member who cannot write no checkbox to select', async () => {
    mockAbility = defineAbilityFor('member');
    mockContacts = [makeContact('Typed', 'manual_import')];
    const { user } = render(<ContactsTable organizationId="org-1" />);

    expect(await menuLabelsOf(user, 'Typed')).not.toContain('Delete');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    // Radix's popover trigger carries aria-haspopup on a div (see
    // contact-table.test.tsx); the rows themselves must audit clean, with no
    // inert checkbox on a row that cannot be selected.
    const rules = { 'aria-allowed-attr': { enabled: false } };

    it('passes axe with synced and editable rows side by side', async () => {
      mockContacts = [
        makeContact('Synced', 'salesforce'),
        makeContact('Typed', 'manual_import'),
      ];
      const { container } = render(<ContactsTable organizationId="org-1" />);
      await checkAccessibility(container, { rules });
    });

    it('passes axe when no row can be selected', async () => {
      mockContacts = [makeContact('Synced', 'salesforce')];
      const { container } = render(<ContactsTable organizationId="org-1" />);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      await checkAccessibility(container, { rules });
    });
  });
});
