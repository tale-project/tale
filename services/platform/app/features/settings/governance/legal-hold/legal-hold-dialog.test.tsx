import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ActiveHoldsSection } from './active-holds-section';

// The active-holds section reads the holds list; the hosted PlaceHoldDialog
// reads matters + org members for its pickers. Mock all three so the section
// renders past its skeleton with a stable empty dataset.
vi.mock('../hooks/queries', () => ({
  useLegalHolds: () => ({ data: [], isLoading: false }),
  useLegalMatters: () => ({ data: [], isLoading: false }),
  useOrgMembersForPicker: () => ({ data: [], isLoading: false }),
}));

// The place-hold dialog, the always-mounted UpsertMatterDialog (nested inside
// it), and the always-mounted request-release dialog each resolve a mutation
// hook at the top level regardless of open state.
vi.mock('../hooks/mutations', () => ({
  usePlaceLegalHold: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpsertLegalMatter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestLegalHoldRelease: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// FormDialog + RequestReleaseDialog read the org id from the router, which has
// no provider in jsdom; return a stable id instead.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

describe('ActiveHoldsSection — place-hold dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Active holds section heading', () => {
    render(<ActiveHoldsSection organizationId="org-1" />);
    expect(
      screen.getByRole('heading', { name: 'Active holds' }),
    ).toBeInTheDocument();
  });

  it('opens and closes the place-hold dialog', async () => {
    const { user } = render(<ActiveHoldsSection organizationId="org-1" />);

    // No dialog before the trigger is clicked.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Click the "Place legal hold" trigger.
    await user.click(screen.getByRole('button', { name: /Place legal hold/i }));

    // The dialog opens (its title equals the trigger label, so assert the
    // dialog ROLE which disambiguates from the button — mirrors the e2e).
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Close it via the dialog's "Close" (X) button without placing a hold.
    await user.click(screen.getByRole('button', { name: 'Close' }));

    // The dialog is removed from the document.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('passes axe audit with the place-hold dialog open', async () => {
    const { user } = render(<ActiveHoldsSection organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: /Place legal hold/i }));
    await screen.findByRole('dialog');
    await checkAccessibility(document.body);
  });
});
