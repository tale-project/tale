import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { PasskeySection } from './passkey-section';

// Shared across the hoisted `vi.mock` factories and the assertions below.
// `deletePasskey` is the credential-destroying call the confirm gate protects;
// spying on it proves it fires ONLY after the dialog is accepted.
const { PASSKEY, PASSKEYS_RESULT, STATUS_RESULT, deletePasskey } = vi.hoisted(
  () => {
    const passkey = { id: 'pk-1', name: 'MacBook Touch ID' };
    return {
      PASSKEY: passkey,
      // Stable identities so re-renders never see a fresh object.
      PASSKEYS_RESULT: { data: [passkey], isLoading: false },
      STATUS_RESULT: { data: { authenticated: true, hasCredential: true } },
      deletePasskey: vi.fn(),
    };
  },
);

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Local-credential gate: a non-SSO user who owns at least one passkey.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => STATUS_RESULT,
}));

// Stub the passkey-list read (so the row renders deterministically) and the
// query-client invalidation seam (there is no QueryClientProvider in a
// component test), mirroring the settings providers-list test.
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => PASSKEYS_RESULT,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    passkey: {
      listUserPasskeys: vi
        .fn()
        .mockResolvedValue({ data: [PASSKEY], error: null }),
      deletePasskey,
    },
  },
}));

// The register dialog is an unrelated subtree; stub it so the test stays
// scoped to the revoke-confirm flow.
vi.mock('./passkey-register-dialog', () => ({
  PasskeyRegisterDialog: () => null,
}));

describe('PasskeySection', () => {
  beforeEach(() => {
    deletePasskey.mockReset();
    deletePasskey.mockResolvedValue({ error: null });
  });

  it('renders a Remove control for each registered passkey', () => {
    render(<PasskeySection />);

    expect(screen.getByText('MacBook Touch ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('opens a destructive confirmation instead of deleting on the first click', async () => {
    const { user } = render(<PasskeySection />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    // The confirm dialog is open and names the credential, but nothing has been
    // revoked yet — a single mis-click is no longer destructive.
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Remove this passkey?' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/MacBook Touch ID/)).toBeInTheDocument();
    expect(deletePasskey).not.toHaveBeenCalled();
  });

  it('revokes the passkey only after the confirmation is accepted', async () => {
    const { user } = render(<PasskeySection />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(deletePasskey).toHaveBeenCalledWith({ id: 'pk-1' });
    });
    // The dialog closes once the credential is removed.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('does not revoke the passkey when the confirmation is cancelled', async () => {
    const { user } = render(<PasskeySection />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(deletePasskey).not.toHaveBeenCalled();
  });

  describe('accessibility', () => {
    it('passes an axe audit in the default state', async () => {
      const { container } = render(<PasskeySection />);

      await checkAccessibility(container);
    });

    it('passes an axe audit with the confirm dialog open', async () => {
      const { user } = render(<PasskeySection />);

      await user.click(screen.getByRole('button', { name: 'Remove' }));
      await screen.findByRole('dialog');

      await checkAccessibility(screen.getByRole('dialog'));
    });
  });
});
