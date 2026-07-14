// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => <a href={to}>{children}</a>,
  useLocation: () => ({
    pathname: '/dashboard/test-org/agents/test-agent',
  }),
  useBlocker: () => ({
    status: 'idle',
    reset: vi.fn(),
    proceed: vi.fn(),
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn() }),
}));

const saveAgentMock = vi.fn();
const restoreAgentMock = vi.fn();
const snapshotMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  // Regression: Save/restore must go through these hooks so the agents list
  // cache (chat ModelSelector / supportedModels) is invalidated after edit.
  useSaveAgent: () => ({ mutateAsync: saveAgentMock }),
  useRestoreFromHistory: () => ({ mutateAsync: restoreAgentMock }),
  useSnapshotToHistory: () => ({ mutateAsync: snapshotMock }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: (date: Date) => date.toISOString(),
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: undefined, isLoaded: true }),
}));

vi.mock('@/app/hooks/use-resize-observer', () => ({
  useResizeObserver: vi.fn(),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    agents: {
      file_actions: {
        snapshotToHistory: 'snapshotToHistory',
        saveAgent: 'saveAgent',
        listHistory: 'listHistory',
        readHistoryEntry: 'readHistoryEntry',
        restoreFromHistory: 'restoreFromHistory',
      },
    },
  },
}));

vi.mock('../../organization/hooks/queries', () => ({
  useOrganization: () => ({ data: undefined, isLoading: false }),
}));

// Mutable so each test can shape the agent config / dirty state the
// component reads.
const agentConfigState = {
  config: {} as Record<string, unknown>,
  initialConfig: {} as Record<string, unknown>,
  isDirty: false,
  isSaving: false,
  resetConfig: vi.fn(),
  markSaving: vi.fn(),
  markSaved: vi.fn(),
  overrideConfig: vi.fn(),
};
vi.mock('../hooks/use-agent-config-context', () => ({
  useAgentConfig: () => agentConfigState,
}));

vi.mock('./history-diff-dialog', () => ({
  HistoryDiffDialog: () => null,
}));

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgentNavigation } from './agent-navigation';

const VALID_CONFIG = {
  displayName: 'Support Agent',
  systemInstructions: 'Help the user.',
  supportedModels: ['openai:gpt-4o'],
};

describe('AgentNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveAgentMock.mockResolvedValue({ hash: 'h' });
    restoreAgentMock.mockResolvedValue({ hash: 'h' });
    snapshotMock.mockResolvedValue(undefined);
    agentConfigState.initialConfig = { ...VALID_CONFIG };
    agentConfigState.config = { ...VALID_CONFIG };
    agentConfigState.isDirty = false;
    agentConfigState.isSaving = false;
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      agentConfigState.config = {};
      agentConfigState.isDirty = false;
      const { container } = render(
        <AgentNavigation
          organizationId="test-org"
          agentId="test-agent"
          onSaved={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('save validity gate (#2665)', () => {
    it('disables Save for a dirty but schema-invalid config', () => {
      // Empty config: no display name / instructions / models — the server's
      // `agentJsonSchema.parse` would reject it, so Save must not be offered.
      agentConfigState.config = { supportedModels: [] };
      agentConfigState.isDirty = true;
      render(
        <AgentNavigation
          organizationId="test-org"
          agentId="test-agent"
          onSaved={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'common.actions.save' }),
      ).toBeDisabled();
    });

    it('enables Save for a dirty, valid config', () => {
      agentConfigState.config = { ...VALID_CONFIG };
      agentConfigState.isDirty = true;
      render(
        <AgentNavigation
          organizationId="test-org"
          agentId="test-agent"
          onSaved={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'common.actions.save' }),
      ).toBeEnabled();
    });
  });

  describe('list cache invalidation after save', () => {
    it('saves via useSaveAgent so chat picks up new supportedModels', async () => {
      const user = userEvent.setup();
      const onSaved = vi.fn();
      const withNewModel = {
        ...VALID_CONFIG,
        supportedModels: ['openai:gpt-4o', 'anthropic:claude-sonnet-4'],
      };
      agentConfigState.config = withNewModel;
      agentConfigState.isDirty = true;

      render(
        <AgentNavigation
          organizationId="test-org"
          agentId="test-agent"
          onSaved={onSaved}
        />,
      );

      await user.click(
        screen.getByRole('button', { name: 'common.actions.save' }),
      );

      expect(saveAgentMock).toHaveBeenCalledWith({
        organizationId: 'test-org',
        agentName: 'test-agent',
        config: withNewModel,
      });
      expect(onSaved).toHaveBeenCalled();
    });
  });
});
