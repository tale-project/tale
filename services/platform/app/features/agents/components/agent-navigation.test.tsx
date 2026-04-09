// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

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

vi.mock('../hooks/use-agent-config-context', () => ({
  useAgentConfig: () => ({
    config: {},
    isDirty: false,
    isSaving: false,
    resetConfig: vi.fn(),
    markSaving: vi.fn(),
    markSaved: vi.fn(),
    overrideConfig: vi.fn(),
  }),
}));

vi.mock('./history-diff-dialog', () => ({
  HistoryDiffDialog: () => null,
}));

import { AgentNavigation } from './agent-navigation';

describe('AgentNavigation', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
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
});
