import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { FileRequestDialog } from './file-request-dialog';

// Migrated from the governance E2E "data-subject-requests: opens and closes the
// file-request dialog". That test only exercised pure client-side dialog UI:
// open the FormDialog, confirm its heading renders, then close via Cancel
// without submitting (so no DSAR record is created — i.e. no mutation fires).
// The dialog's collaborators (the erasure mutation, the member-picker query,
// the toast, and router navigation) are only touched on submit, never on
// open/close, so they are mocked away and the behavior asserted here is the
// same open -> heading-visible -> Cancel -> closed flow the E2E asserted.

const mockRequestErasure = vi.fn();

vi.mock('./hooks/mutations', () => ({
  useRequestErasure: () => ({
    mutateAsync: mockRequestErasure,
    isPending: false,
  }),
}));

// The subject picker query — return an empty member list so the dialog renders
// without a live Convex backend. Open/close never reads member data.
vi.mock('./hooks/queries', () => ({
  useOrgMembersForErasurePicker: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// FormDialog's error boundary reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other dialog tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// The component calls useNavigate() (only used on a successful submit). Outside
// a RouterProvider it throws on mount, so stub it.
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

const TITLE = 'File erasure request';

describe('FileRequestDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dialog with its erasure-request heading when open', async () => {
    const { container } = render(
      <FileRequestDialog
        open={true}
        onOpenChange={vi.fn()}
        organizationId="org-1"
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The dialog heading ("File erasure request") differs from the page action
    // label ("File request"), so it is an unambiguous open signal — mirrors the
    // E2E assertion exactly.
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument();

    await checkAccessibility(container);
  });

  it('does not render the dialog when closed', () => {
    render(
      <FileRequestDialog
        open={false}
        onOpenChange={vi.fn()}
        organizationId="org-1"
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: TITLE }),
    ).not.toBeInTheDocument();
  });

  it('requests close via Cancel without filing a request', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <FileRequestDialog
        open={true}
        onOpenChange={onOpenChange}
        organizationId="org-1"
      />,
    );

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    // Closing without submitting requests close (parent-controlled) and files
    // no DSAR — the mutation must never run, matching the E2E's "no DSAR record
    // is created" guarantee.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockRequestErasure).not.toHaveBeenCalled();
  });

  it('hides the dialog once the parent flips open to false', () => {
    const { rerender } = render(
      <FileRequestDialog
        open={true}
        onOpenChange={vi.fn()}
        organizationId="org-1"
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    rerender(
      <FileRequestDialog
        open={false}
        onOpenChange={vi.fn()}
        organizationId="org-1"
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
