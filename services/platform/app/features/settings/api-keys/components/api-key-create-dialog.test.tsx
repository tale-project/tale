import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ApiKeyCreateDialog } from './api-key-create-dialog';

const mockCreateKey = vi
  .fn()
  .mockResolvedValue({ key: 'tale_generated-api-key' });

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/use-api-keys', () => ({
  useCreateApiKey: () => ({ mutateAsync: mockCreateKey, isPending: false }),
}));

describe('ApiKeyCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The key name is capped at Better Auth's apiKey `maximumNameLength` default
  // (32). Before #1991 the client only gated on non-empty, so a long name passed
  // the client and Better Auth returned a generic 400 that surfaced as an
  // undismissable error toast. The cap is now enforced inline via the shared
  // `common.validation.maxLength` message, and FormDialog disables submit while
  // `!isValid`.
  describe('name length validation', () => {
    it('rejects a name over the 32-char cap and accepts one at the cap', async () => {
      const { user } = render(
        <ApiKeyCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      const nameField = screen.getByRole('textbox', { name: /Key name/ });
      const submit = screen.getByRole('button', { name: 'Create key' });

      // 33 chars → over the cap. The inline message surfaces only after the
      // first blur (onTouched, #1943); submit is disabled while over the cap.
      await user.type(nameField, 'a'.repeat(33));
      await user.tab();
      expect(
        await screen.findByText('Key name must be 32 characters or fewer'),
      ).toBeInTheDocument();
      expect(submit).toBeDisabled();

      // Exactly 32 → valid → message clears, submit ENABLED.
      await user.clear(nameField);
      await user.type(nameField, 'a'.repeat(32));
      await waitFor(() => {
        expect(
          screen.queryByText('Key name must be 32 characters or fewer'),
        ).not.toBeInTheDocument();
        expect(submit).toBeEnabled();
      });
      expect(mockCreateKey).not.toHaveBeenCalled();
    });

    it('submits a valid name to createKey', async () => {
      const { user } = render(
        <ApiKeyCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      await waitFor(() => {
        expect(mockCreateKey).toHaveBeenCalledTimes(1);
      });
      expect(mockCreateKey).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'CI Token' }),
      );
    });
  });

  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ApiKeyCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <ApiKeyCreateDialog
          open={false}
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
