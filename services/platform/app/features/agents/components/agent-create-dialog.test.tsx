// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const navigateSpy = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

const saveAgentMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useSaveAgent: () => ({ mutateAsync: saveAgentMock }),
  useInstallCatalogAgent: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }),
}));

// The dialog reads the existing agents to warn on duplicate display names.
// `useListAgents` is an action-backed query (needs a ConvexProvider), so stub
// it here the same way the other data hooks are stubbed. `existingAgents` is
// mutable so individual tests can seed a clashing display name.
let existingAgents: Array<Record<string, unknown>> = [];
vi.mock('../hooks/queries', () => ({
  useListAgents: () => ({ agents: existingAgents }),
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
  beforeEach(() => {
    vi.clearAllMocks();
    saveAgentMock.mockResolvedValue({ hash: 'h' });
    existingAgents = [];
  });

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

  // Display names aren't unique (only the slug is), so a clash is silent
  // ambiguity. The dialog surfaces a non-blocking warning — Continue stays
  // enabled — when the entered display name already belongs to another agent.
  describe('duplicate display-name warning (#1999)', () => {
    it('warns (case-insensitively) without blocking submit when the display name clashes', async () => {
      existingAgents = [{ name: 'support-bot', displayName: 'Support Bot' }];
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

      await user.type(
        screen.getByLabelText('settings.agents.form.name'),
        'support-bot-2',
      );
      // Different casing/whitespace still resolves to the same display name.
      await user.type(
        screen.getByLabelText('settings.agents.form.displayName'),
        '  support bot  ',
      );

      await waitFor(() =>
        expect(
          screen.getByText('settings.agents.form.displayNameDuplicateWarning'),
        ).toBeInTheDocument(),
      );
      // Non-blocking: the warning does not gate Continue.
      await waitFor(() => expect(submit).toBeEnabled());
    });

    it('shows no warning when the display name is unique', async () => {
      existingAgents = [{ name: 'support-bot', displayName: 'Support Bot' }];
      const { user } = render(
        <CreateAgentDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="test-org-id"
        />,
      );

      await user.type(
        screen.getByLabelText('settings.agents.form.displayName'),
        'Sales Bot',
      );

      expect(
        screen.queryByText('settings.agents.form.displayNameDuplicateWarning'),
      ).not.toBeInTheDocument();
    });
  });

  // A `/` in the name files the agent into a folder. The name is saved verbatim
  // (the backend writes it to `agents/<folder>/<slug>.json`), but the agent's
  // identity slug — and so the route it navigates to — is the last path segment.
  describe('folder create navigation', () => {
    it('saves the foldered name but navigates by the basename slug', async () => {
      const { user } = render(
        <CreateAgentDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );

      await user.type(
        screen.getByLabelText('settings.agents.form.name'),
        'marketing/seo-writer',
      );
      await user.type(
        screen.getByLabelText('settings.agents.form.displayName'),
        'SEO Writer',
      );

      const submit = screen.getByRole('button', {
        name: 'settings.agents.createDialog.continue',
      });
      // The slash is valid — Continue enables and no pattern error renders.
      await waitFor(() => expect(submit).toBeEnabled());
      expect(
        screen.queryByText('settings.agents.form.namePatternError'),
      ).not.toBeInTheDocument();

      await user.click(submit);

      // Saved with the foldered name (the backend derives folder + slug)…
      await waitFor(() =>
        expect(saveAgentMock).toHaveBeenCalledWith(
          expect.objectContaining({
            agentName: 'marketing/seo-writer',
            isNew: true,
          }),
        ),
      );
      // …but the editor route uses the flat identity slug (basename).
      await waitFor(() =>
        expect(navigateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            to: '/dashboard/$id/agents/$agentId',
            params: { id: 'org-1', agentId: 'seo-writer' },
          }),
        ),
      );
    });
  });

  // Migrated from tests/e2e/specs/validation.spec.ts —
  // "rejects an invalid slug and an empty name; cancels without creating".
  // Pure client-side RHF + zod (mode: 'onChange'); the seeded mock provider
  // supplies a model so the slug/name are the only things gating Continue.
  describe('slug + required validation gating (migrated from e2e)', () => {
    it('rejects an invalid slug and an empty name; cancels without creating', async () => {
      const onOpenChange = vi.fn();
      const { user } = render(
        <CreateAgentDialog
          open={true}
          onOpenChange={onOpenChange}
          organizationId="test-org-id"
        />,
      );

      const slugField = screen.getByLabelText('settings.agents.form.name');
      const displayNameField = screen.getByLabelText(
        'settings.agents.form.displayName',
      );
      const continueButton = screen.getByRole('button', {
        name: 'settings.agents.createDialog.continue',
      });

      // (a) Invalid slug + valid display name → Continue stays DISABLED and the
      // pattern error renders (mode: 'onChange').
      await user.type(slugField, 'Bad Slug!');
      await user.type(displayNameField, 'Valid Display Name');
      await waitFor(() =>
        expect(
          screen.getByText('settings.agents.form.namePatternError'),
        ).toBeInTheDocument(),
      );
      expect(continueButton).toBeDisabled();

      // (b) A valid slug clears the error and ENABLES Continue.
      await user.clear(slugField);
      await user.type(slugField, 'valid-slug');
      await waitFor(() =>
        expect(
          screen.queryByText('settings.agents.form.namePatternError'),
        ).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(continueButton).toBeEnabled());

      // (c) Clearing the display name → required error + Continue DISABLED again.
      // The mocked useT leaves the `{field}` placeholder un-interpolated, so the
      // rendered required message is the resolved `common.validation.required`
      // key (the real e2e asserts "Display name is required").
      await user.clear(displayNameField);
      await waitFor(() =>
        expect(
          screen.getByText('common.validation.required'),
        ).toBeInTheDocument(),
      );
      await waitFor(() => expect(continueButton).toBeDisabled());

      // Cancel without creating → the dialog requests close (open is controlled
      // by the host via onOpenChange, mirroring the e2e's "dialog hidden").
      await user.click(
        screen.getByRole('button', { name: 'common.actions.cancel' }),
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
