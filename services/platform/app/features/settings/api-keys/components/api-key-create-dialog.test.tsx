import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ApiKeyCreateDialog } from './api-key-create-dialog';

const mockCreateKey = vi
  .fn()
  .mockResolvedValue({ key: 'tale_generated-api-key' });

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@tale/ui/use-toast', () => ({
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

  // The page lives under one organization, but a key belongs to the person
  // and works in every organization they are a member of — the dialog says
  // so before the name is typed (2026-09-26 evaluation, E-09).
  it('says the key belongs to the person and spans their organizations', () => {
    render(
      <ApiKeyCreateDialog open onOpenChange={vi.fn()} organizationId="org-1" />,
    );
    expect(
      screen.getByText(/belongs to you, not to this organization/),
    ).toBeInTheDocument();
    expect(screen.getByText(/X-Organization-Slug/)).toBeInTheDocument();
  });

  // The lifetime is read as a date: every choice says the day the key
  // stops working, and "Custom date" picks that day in a calendar.
  describe('expiry', () => {
    // Wednesday 2026-10-07, 09:00 local.
    const NOW = new Date(2026, 9, 7, 9, 0).getTime();

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function renderDialog() {
      const view = render(
        <ApiKeyCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      return view;
    }

    it('starts at 30 days and says the day the key stops working', async () => {
      const { user } = renderDialog();
      const expiry = screen.getByRole('combobox', { name: 'Expiration' });
      expect(expiry).toHaveTextContent('30 days');
      expect(expiry).toHaveAccessibleDescription(
        'The key expires on November 6, 2026.',
      );

      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'CI Token',
          expiresIn: 2_592_000,
        }),
      );
    });

    it('creates a key without an expiry when Never is chosen', async () => {
      const { user } = renderDialog();
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Never' }));
      expect(
        screen.getByRole('combobox', { name: 'Expiration' }),
      ).toHaveAccessibleDescription('The key works until it is revoked.');

      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'CI Token',
          expiresIn: undefined,
        }),
      );
    });

    it('expires on the day picked under Custom date', async () => {
      const { user } = renderDialog();
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Custom date' }));

      // The calendar opens on a day a month out, named with its label.
      const date = screen.getByRole('button', {
        name: 'Expiration date Nov 6, 2026',
      });
      await user.click(date);
      await user.click(
        screen.getByRole('gridcell', { name: /November 20th, 2026$/ }),
      );
      expect(
        screen.getByRole('button', { name: 'Expiration date Nov 20, 2026' }),
      ).toHaveAccessibleDescription('The key expires on November 20, 2026.');

      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      const submit = screen.getByRole('button', { name: 'Create key' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
      // 2026-10-07 → 2026-11-20 is 44 days.
      await waitFor(() =>
        expect(mockCreateKey).toHaveBeenCalledWith({
          name: 'CI Token',
          expiresIn: 44 * 86_400,
        }),
      );
    });

    it('offers no day before tomorrow or past a year from today', async () => {
      const { user } = renderDialog();
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Custom date' }));
      await user.click(
        screen.getByRole('button', { name: 'Expiration date Nov 6, 2026' }),
      );
      await user.click(screen.getByRole('button', { name: 'Previous month' }));
      expect(
        screen.getByRole('gridcell', { name: /October 7th, 2026$/ }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(
        screen.getByRole('gridcell', { name: /October 8th, 2026$/ }),
      ).toHaveAttribute('aria-disabled', 'false');
    });

    it('asks for a day when Custom date has none', async () => {
      const { user } = renderDialog();
      await user.type(
        screen.getByRole('textbox', { name: /Key name/ }),
        'CI Token',
      );
      await user.click(screen.getByRole('combobox', { name: 'Expiration' }));
      await user.click(screen.getByRole('option', { name: 'Custom date' }));
      await user.click(screen.getByRole('button', { name: 'Clear date' }));

      expect(
        await screen.findByText('Pick an expiration date.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled();
      expect(mockCreateKey).not.toHaveBeenCalled();
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
