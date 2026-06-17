// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/mutations', () => ({
  useSaveAgent: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useModelCapabilities: () => new Map(),
  useListProviders: () => ({
    providers: [
      {
        models: [{ id: 'model-1', displayName: 'Test Model' }],
      },
    ],
  }),
}));

import { CreateAgentDialog } from './agent-create-dialog';

describe('CreateAgentDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <CreateAgentDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await checkAccessibility(container);
    });
  });

  // Regression test for #1466: the Continue button must stay disabled
  // until the required fields (name, displayName) are valid, instead of
  // only failing after a submit attempt.
  describe('submit gating (#1466)', () => {
    it('keeps Continue disabled until required fields are valid', async () => {
      const { user } = render(
        <CreateAgentDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="test-org-id"
        />,
      );

      const submit = screen.getByRole('button', {
        name: 'settings.agents.createDialog.continue',
      });
      expect(submit).toBeDisabled();

      await user.type(
        screen.getByLabelText('settings.agents.form.name'),
        'support-bot',
      );
      await user.type(
        screen.getByLabelText('settings.agents.form.displayName'),
        'Support Bot',
      );

      await waitFor(() => expect(submit).toBeEnabled());
    });

    it('keeps Continue disabled when name violates the slug pattern', async () => {
      const { user } = render(
        <CreateAgentDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="test-org-id"
        />,
      );

      const submit = screen.getByRole('button', {
        name: 'settings.agents.createDialog.continue',
      });

      // Uppercase/spaces violate the ^[a-z0-9][a-z0-9_-]*$ slug rule.
      await user.type(
        screen.getByLabelText('settings.agents.form.name'),
        'Invalid Name',
      );
      await user.type(
        screen.getByLabelText('settings.agents.form.displayName'),
        'Support Bot',
      );

      await waitFor(() => expect(submit).toBeDisabled());
    });
  });
});
