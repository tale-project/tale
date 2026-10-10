import { AppShell } from '@tale/ui/app-shell';
import { render as renderWithProviders } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { DefaultModelEditor } from './default-model-editor';

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
//
// `result` is the object the mocked hook hands back. It MUST be referentially
// stable between renders: the real react-query/convex hook returns a stable
// value until the data changes, and the editor's `savedConfig` memo (plus the
// effect that seeds rules from it) is keyed on that reference. Returning a
// fresh `{ data, isLoading }` object per render re-seeds state every render,
// spinning an unbounded re-render loop that exhausts the heap (the worker
// OOMs). Rebuild the snapshot only when a scenario helper changes state.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true, rules: [] } as {
      enabled: boolean;
      rules: unknown[];
    } | null,
    accessConfig: null as Record<string, unknown> | null,
    result: undefined as unknown,
  },
}));

function refreshPolicy() {
  state.result = {
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  };
}
refreshPolicy();

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: (_organizationId: string, policyType: string) => ({
    isLoading: state.isLoading,
    data: state.isLoading
      ? undefined
      : {
          config:
            policyType === 'model_access' ? state.accessConfig : state.config,
        },
  }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [{ id: 'team-1', name: 'Engineering' }],
    isLoading: false,
  }),
}));

vi.mock('../hooks/model-catalog', () => ({
  useModelCapabilities: () => new Map(),
  useListProviders: () => ({
    providers: [
      {
        name: 'openai',
        displayName: 'OpenAI',
        models: [
          { id: 'openai/gpt-4o', displayName: 'GPT-4o', tags: ['chat'] },
        ],
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function setLoaded() {
  state.isLoading = false;
  state.config = {
    enabled: true,
    rules: [
      { scope: 'default', providerName: 'openai', modelId: 'openai/gpt-4o' },
    ],
  };
  state.accessConfig = null;
  refreshPolicy();
}
function setLoading() {
  state.isLoading = true;
  state.config = null;
  state.accessConfig = null;
  refreshPolicy();
}

describe('DefaultModelEditor', () => {
  it.each(['en', 'de', 'fr'])(
    'localizes rule scope and role labels (%s)',
    async (language) => {
      await i18n.changeLanguage(language);
      try {
        setLoaded();
        state.config = {
          enabled: true,
          rules: [
            {
              scope: 'role',
              scopeId: 'developer',
              providerName: 'openai',
              modelId: 'openai/gpt-4o',
            },
          ],
        };
        refreshPolicy();
        const t = i18n.getFixedT(language, 'governance');
        // Keep the selected test language: the shared render helper's client
        // locale bridge would replace it with the detected browser preference.
        const user = userEvent.setup();
        renderWithProviders(
          <AppShell i18n={i18n}>
            <DefaultModelEditor organizationId="org-1" />
          </AppShell>,
        );
        expect(
          screen.getByRole('cell', {
            name: t('defaultModels.scopeLabels.role'),
          }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('cell', {
            name: t('defaultModels.roleLabels.developer'),
          }),
        ).toBeInTheDocument();
        await user.click(
          screen.getByRole('button', {
            name: t('defaultModels.editRule', { index: 1 }),
          }),
        );
        const dialog = within(screen.getByRole('dialog'));
        const scopeSelect = dialog.getByRole('combobox', {
          name: t('defaultModels.scope'),
        });
        expect(scopeSelect).toHaveTextContent(
          t('defaultModels.scopeLabels.role'),
        );
        await user.click(scopeSelect);
        for (const value of ['default', 'team', 'role']) {
          expect(
            i18n.exists(`defaultModels.scopeLabels.${value}`, {
              lng: language,
              ns: 'governance',
            }),
          ).toBe(true);
          expect(
            screen.getByRole('option', {
              name: t(`defaultModels.scopeLabels.${value}`),
            }),
          ).toBeInTheDocument();
        }
        await user.keyboard('{Escape}');
        const roleSelect = dialog.getByRole('combobox', {
          name: t('defaultModels.role'),
        });
        expect(roleSelect).toHaveTextContent(
          t('defaultModels.roleLabels.developer'),
        );
        await user.click(roleSelect);
        for (const value of ['admin', 'developer', 'editor', 'member']) {
          expect(
            i18n.exists(`defaultModels.roleLabels.${value}`, {
              lng: language,
              ns: 'governance',
            }),
          ).toBe(true);
          expect(
            screen.getByRole('option', {
              name: t(`defaultModels.roleLabels.${value}`),
            }),
          ).toBeInTheDocument();
        }
        await user.keyboard('{Escape}');
      } finally {
        cleanup();
        await i18n.changeLanguage('en');
      }
    },
  );

  describe('loaded state', () => {
    it('renders the real action button (in the a11y tree)', () => {
      setLoaded();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(
        screen.getByRole('button', { name: /add rule/i }),
      ).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /default models/i }),
      ).toBeInTheDocument();
    });

    it('renders the saved rule rows (real data, no placeholders)', () => {
      setLoaded();
      const { container } = render(
        <DefaultModelEditor organizationId="org-1" />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: /edit rule 1/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the interactive controls (no live buttons while loading)', () => {
      setLoading();
      render(<DefaultModelEditor organizationId="org-1" />);
      // The masked action button is aria-hidden → excluded from the a11y tree.
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('renders placeholder rows so the table reads as loading, not empty', () => {
      setLoading();
      const { container } = render(
        <DefaultModelEditor organizationId="org-1" />,
      );
      // Three placeholder rows, NOT the empty-state row.
      expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
      expect(
        screen.queryByText(/no rules configured/i),
      ).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<DefaultModelEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /default models/i }),
      ).toBeInTheDocument();
    });
  });
});
