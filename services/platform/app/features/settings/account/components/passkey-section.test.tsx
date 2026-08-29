// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

// Regression cover for #2081: the self-service passkey "Remove" action must not
// revoke a phishing-resistant credential on a single click — it has to go
// through a destructive confirmation first (the fix landed in #2112). These
// tests pin that seam so the confirm step can't silently regress back to a
// one-click delete.

// A single seeded passkey the list query returns. Hoisted so the
// `@tanstack/react-query` mock factory (evaluated before the imports below) can
// read it.
const { PASSKEY, mockStatus } = vi.hoisted(() => ({
  PASSKEY: { id: 'pk-1', name: 'YubiKey 5C', createdAt: 1_700_000_000_000 },
  // A local, credentialed session is the precondition for the passkeys UI
  // to render at all (SSO-only users don't manage local credentials here).
  mockStatus: { value: { authenticated: true, hasCredential: true } },
}));

// WebAuthn client. `deletePasskey` is the irreversible call under guard: it must
// fire only after the confirmation is accepted, never on the row action click.
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    passkey: {
      deletePasskey: vi.fn().mockResolvedValue({}),
      listUserPasskeys: vi.fn(),
      addPasskey: vi.fn(),
    },
  },
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The register dialog drives its own browser ceremony + unrelated deps; it is
// irrelevant to the revoke-confirm seam under test.
vi.mock('./passkey-register-dialog', () => ({
  PasskeyRegisterDialog: () => null,
}));

// Exercise the section through the list result only: return the seeded passkey
// synchronously (there is no QueryClientProvider in a component test) and stub
// the client the post-revoke `invalidate()` reads. AppShell — the shared render
// wrapper — carries no react-query itself, so overriding these two hooks only
// affects the section under test.
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  // Two reads share this hook now: the passkey list and the 2FA status
  // (['backend', …] keys, served over HTTP). Switch on the key shape.
  useQuery: (options: { queryKey?: unknown[] }) =>
    Array.isArray(options?.queryKey) && options.queryKey[0] === 'backend'
      ? { data: mockStatus.value, isLoading: false }
      : { data: [PASSKEY], isLoading: false },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { authClient } from '@/lib/auth-client';

import { PasskeySection } from './passkey-section';

// The trash icon action and the confirm dialog's confirm button share the
// "Remove" accessible name (both bound to `passkeys.revokeButton`), so the
// confirm click is always scoped inside the dialog.
const REMOVE = 'Remove';
const CONFIRM_TITLE = /remove passkey\?/i;

describe('PasskeySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('revoke confirmation', () => {
    it('opens a confirm dialog instead of revoking on the row action click', async () => {
      const { user } = render(<PasskeySection />);

      // The row exposes a single icon-only "Remove" action.
      await user.click(screen.getByRole('button', { name: REMOVE }));

      // A single click must NOT delete the credential; it opens a destructive
      // confirmation dialog and waits.
      expect(authClient.passkey.deletePasskey).not.toHaveBeenCalled();
      expect(
        await screen.findByRole('dialog', { name: CONFIRM_TITLE }),
      ).toBeInTheDocument();
    });

    it('revokes only after the destructive confirmation is accepted', async () => {
      const { user } = render(<PasskeySection />);

      await user.click(screen.getByRole('button', { name: REMOVE }));
      const dialog = await screen.findByRole('dialog', { name: CONFIRM_TITLE });

      // Confirming inside the dialog is what actually revokes the passkey.
      await user.click(within(dialog).getByRole('button', { name: REMOVE }));

      await waitFor(() =>
        expect(authClient.passkey.deletePasskey).toHaveBeenCalledWith({
          id: PASSKEY.id,
        }),
      );
    });

    it('does not revoke when the confirmation is dismissed', async () => {
      const { user } = render(<PasskeySection />);

      await user.click(screen.getByRole('button', { name: REMOVE }));
      const dialog = await screen.findByRole('dialog', { name: CONFIRM_TITLE });

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(authClient.passkey.deletePasskey).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('passes an axe audit with the confirm dialog open', async () => {
      const { user, baseElement } = render(<PasskeySection />);

      await user.click(screen.getByRole('button', { name: REMOVE }));
      await screen.findByRole('dialog', { name: CONFIRM_TITLE });

      await checkAccessibility(baseElement);
    });
  });
});
