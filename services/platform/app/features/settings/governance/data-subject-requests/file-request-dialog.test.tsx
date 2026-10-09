import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@/tests/utils/render';

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
const mockRefetch = vi.fn();
const member = {
  userId: 'user-1',
  displayName: 'Ada Example',
  email: 'ada@example.test',
  role: 'member',
};
let memberQuery = {
  data: [] as (typeof member)[] | undefined,
  isLoading: false,
  isError: false,
  isSuccess: true,
  isFetching: false,
  errorUpdatedAt: 0,
  errorUpdateCount: 0,
  error: undefined as unknown,
  refetch: mockRefetch,
};

vi.mock('./hooks/mutations', () => ({
  useRequestErasure: () => ({
    mutateAsync: mockRequestErasure,
    isPending: false,
  }),
}));

// The subject picker query — return an empty member list so the dialog renders
// without a live Convex backend. Open/close never reads member data.
vi.mock('./hooks/queries', () => ({
  useOrgMembersForErasurePicker: () => memberQuery,
}));

vi.mock('@tale/ui/use-toast', () => ({
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
    memberQuery = {
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      isFetching: false,
      errorUpdatedAt: 0,
      errorUpdateCount: 0,
      error: undefined,
      refetch: mockRefetch,
    };
  });

  it('distinguishes a failed read and retries without losing focus', async () => {
    memberQuery = {
      ...memberQuery,
      data: undefined,
      isError: true,
      isSuccess: false,
      errorUpdatedAt: 1,
    };
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      organizationId: 'org-1',
    };
    const { user, rerender } = render(<FileRequestDialog {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Members could not be loaded.',
    );
    expect(screen.queryByText('No matching members.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File request' })).toBeDisabled();
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    expect(mockRefetch).toHaveBeenCalledOnce();
    memberQuery = {
      ...memberQuery,
      isError: false,
      isLoading: true,
      isFetching: true,
    };
    rerender(<FileRequestDialog {...props} />);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    await user.click(retry);
    expect(mockRefetch).toHaveBeenCalledOnce();
    memberQuery = {
      ...memberQuery,
      data: [member],
      isLoading: false,
      isFetching: false,
      isSuccess: true,
    };
    rerender(<FileRequestDialog {...props} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Subject/ })).toHaveFocus(),
    );
    await user.click(screen.getByRole('button', { name: /Subject/ }));
    expect(
      screen.getByRole('option', { name: /Ada Example/ }),
    ).toBeInTheDocument();
  });

  it('keeps the loaded subjects in an open picker after a failed refresh', async () => {
    memberQuery.data = [member];
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      organizationId: 'org-1',
    };
    const { user, rerender } = render(<FileRequestDialog {...props} />);
    await user.click(screen.getByRole('button', { name: /Subject/ }));
    expect(
      screen.getByRole('option', { name: /Ada Example/ }),
    ).toBeInTheDocument();
    memberQuery = {
      ...memberQuery,
      isError: true,
      isSuccess: false,
      errorUpdatedAt: 1,
      errorUpdateCount: 1,
    };
    rerender(<FileRequestDialog {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Members could not be loaded.',
    );
    expect(
      screen.getByRole('option', { name: /Ada Example/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No matching members.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File request' })).toBeDisabled();
  });

  it('returns Escape focus to Subject after an open picker refresh fails', async () => {
    memberQuery.data = [member];
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      organizationId: 'org-1',
    };
    const { user, rerender } = render(<FileRequestDialog {...props} />);
    const trigger = screen.getByRole('button', { name: /Subject/ });
    await user.click(trigger);
    memberQuery = {
      ...memberQuery,
      isError: true,
      isSuccess: false,
      errorUpdatedAt: 1,
      errorUpdateCount: 1,
    };
    rerender(<FileRequestDialog {...props} />);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('names a failed refresh of an empty answer instead of showing matching copy', async () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      organizationId: 'org-1',
    };
    const { user, rerender } = render(<FileRequestDialog {...props} />);
    await user.click(screen.getByRole('button', { name: /Subject/ }));
    expect(screen.getByText('No matching members.')).toBeInTheDocument();
    memberQuery = {
      ...memberQuery,
      isError: true,
      isSuccess: false,
      errorUpdatedAt: 1,
      errorUpdateCount: 1,
    };
    rerender(<FileRequestDialog {...props} />);
    expect(
      within(screen.getByRole('listbox')).getByText(
        'Members could not be loaded.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('No matching members.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subject/ })).toBeEnabled();
  });

  it('gates direct form submission during a stale failure and permits recovered data', async () => {
    memberQuery.data = [member];
    mockRequestErasure.mockResolvedValue({ requestId: 'request-1' });
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      organizationId: 'org-1',
    };
    const { user, rerender } = render(<FileRequestDialog {...props} />);
    await user.click(screen.getByRole('button', { name: /Subject/ }));
    await user.click(screen.getByRole('option', { name: /Ada Example/ }));
    await user.type(
      screen.getByRole('textbox', { name: /Reason narrative/ }),
      'Subject withdrew consent',
    );
    await user.type(
      screen.getByRole('textbox', { name: /Type ERASE/ }),
      'ERASE',
    );
    const submit = screen.getByRole('button', { name: 'File request' });
    expect(submit).toBeEnabled();
    const form = submit.closest('form');
    if (!form) throw new Error('Expected the actual erasure request form.');
    memberQuery = {
      ...memberQuery,
      isError: true,
      isSuccess: false,
      errorUpdatedAt: 1,
      errorUpdateCount: 1,
    };
    rerender(<FileRequestDialog {...props} />);
    expect(submit).toBeDisabled();
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(mockRequestErasure).not.toHaveBeenCalled();
    memberQuery = { ...memberQuery, isError: false, isSuccess: true };
    rerender(<FileRequestDialog {...props} />);
    expect(submit).toBeEnabled();
    await act(async () => {
      fireEvent.submit(form);
    });
    await waitFor(() => expect(mockRequestErasure).toHaveBeenCalledOnce());
    expect(mockRequestErasure).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'user-1',
      reason: 'Subject withdrew consent',
      reasonCode: 'no_longer_necessary',
    });
  });

  it('keeps normal empty copy for a successful empty directory', async () => {
    const { user } = render(
      <FileRequestDialog open onOpenChange={vi.fn()} organizationId="org-1" />,
    );
    await user.click(screen.getByRole('button', { name: /Subject/ }));
    expect(screen.getByText('No matching members.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not present loading as an empty directory', () => {
    memberQuery = {
      ...memberQuery,
      data: undefined,
      isLoading: true,
      isFetching: true,
      isSuccess: false,
    };
    render(
      <FileRequestDialog open onOpenChange={vi.fn()} organizationId="org-1" />,
    );
    expect(screen.getByLabelText('Subject')).toBeDisabled();
    expect(
      screen.getByRole('status', { name: 'Loading content' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File request' })).toBeDisabled();
    expect(screen.queryByText('No matching members.')).not.toBeInTheDocument();
  });

  it('blocks a previously valid submission after a failed read or removed member', async () => {
    memberQuery.data = [member];
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      organizationId: 'org-1',
    };
    const { user, rerender } = render(<FileRequestDialog {...props} />);
    await user.click(screen.getByRole('button', { name: /Subject/ }));
    await user.click(screen.getByRole('option', { name: /Ada Example/ }));
    await user.type(
      screen.getByRole('textbox', { name: /Reason narrative/ }),
      'Subject withdrew consent',
    );
    await user.type(
      screen.getByRole('textbox', { name: /Type ERASE/ }),
      'ERASE',
    );
    expect(screen.getByRole('button', { name: 'File request' })).toBeEnabled();
    memberQuery = {
      ...memberQuery,
      isError: true,
      isSuccess: false,
      errorUpdatedAt: 1,
    };
    rerender(<FileRequestDialog {...props} />);
    expect(screen.getByRole('button', { name: 'File request' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(mockRequestErasure).not.toHaveBeenCalled();
    await checkAccessibility(screen.getByRole('dialog'));
    memberQuery = { ...memberQuery, isError: false, isSuccess: true };
    rerender(<FileRequestDialog {...props} />);
    expect(screen.getByRole('button', { name: 'File request' })).toBeEnabled();
    memberQuery.data = [];
    rerender(<FileRequestDialog {...props} />);
    expect(screen.getByRole('button', { name: 'File request' })).toBeDisabled();
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
