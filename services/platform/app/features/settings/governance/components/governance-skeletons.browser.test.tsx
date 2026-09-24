import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { BudgetEditor } from './budget-editor';
import { ConversationRoutingPolicyEditor } from './conversation-routing-policy-editor';
import { FeatureFlagsEditor } from './feature-flags-editor';
import { ModelAccessEditor } from './model-access-editor';

import '@/app/globals.css';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
const { state, members, teams, providers, apiKeys, mailboxes, backendQuery } =
  vi.hoisted(() => ({
    state: {
      result: { data: undefined, isLoading: true } as {
        data: { config: Record<string, unknown> } | undefined;
        isLoading: boolean;
      },
    },
    members: { members: [{ userId: 'user-1', displayName: 'Alice' }] },
    teams: { teams: [{ id: 'team-1', name: 'Finance' }] },
    providers: { providers: [] },
    apiKeys: { data: [] },
    mailboxes: { mailboxes: [] },
    backendQuery: { data: [], isLoading: false },
  }));
vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => state.result,
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => members,
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => teams,
}));
vi.mock('../hooks/model-catalog', () => ({
  useListProviders: () => providers,
  useModelCapabilities: () => new Map(),
}));
vi.mock('@/app/features/settings/api-keys/hooks/use-api-keys', () => ({
  useApiKeys: () => apiKeys,
}));
// The routing editor lists mailboxes and API apps as arrival points.
vi.mock('@/app/features/conversations/hooks/queries', () => ({
  EMAIL_PROVIDER_SLUGS: new Set(['gmail', 'outlook', 'imap-smtp']),
  useMailboxes: () => mailboxes,
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => backendQuery,
}));

afterEach(cleanup);

describe('Governance rule table skeleton geometry', () => {
  const scenarios = [
    {
      name: 'model access',
      Editor: ModelAccessEditor,
      count: 3,
      numericColumns: [],
      config: {
        enabled: true,
        mode: 'blocklist',
        rules: Array.from({ length: 3 }, () => ({
          scope: 'default',
          allowedModels: [],
          blockedModels: ['chat-model'],
        })),
      },
    },
    {
      name: 'conversation routing',
      Editor: ConversationRoutingPolicyEditor,
      count: 2,
      numericColumns: [],
      config: {
        enabled: true,
        rules: Array.from({ length: 2 }, (_, index) => ({
          address: `team${index}@example.test`,
          teamId: 'team-1',
        })),
      },
    },
    {
      name: 'feature flags',
      Editor: FeatureFlagsEditor,
      count: 3,
      numericColumns: [2],
      config: {
        enabled: true,
        rules: Array.from({ length: 3 }, () => ({
          scope: 'default',
          maxContextTokens: 50000,
        })),
      },
    },
    {
      name: 'budgets',
      Editor: BudgetEditor,
      count: 3,
      numericColumns: [3, 4, 5],
      config: {
        enabled: true,
        rules: Array.from({ length: 3 }, () => ({
          scope: 'default',
          period: 'monthly',
          maxTokens: 1000000,
        })),
      },
    },
  ];

  it.each(scenarios)(
    'keeps $name row heights and action surfaces when data arrives',
    ({ Editor, config, count, numericColumns }) => {
      state.result = { data: undefined, isLoading: true };
      const view = (
        <div style={{ width: 960 }}>
          <Editor organizationId="org-1" />
        </div>
      );
      const { container, rerender } = render(view);
      const rows = () => Array.from(container.querySelectorAll('tbody tr'));
      const rowHeights = () =>
        rows().map((row) => row.getBoundingClientRect().height);
      const actions = (selector: string) =>
        rows().flatMap((row) => {
          const cells = row.querySelectorAll('td');
          const lastCell = cells[cells.length - 1];
          return Array.from(lastCell?.querySelectorAll(selector) ?? []).map(
            (node) => ({
              height: node.getBoundingClientRect().height,
              width: node.getBoundingClientRect().width,
              radius: getComputedStyle(node).borderRadius,
            }),
          );
        });
      expect(rows()).toHaveLength(count);
      for (const row of rows()) {
        const cells = row.querySelectorAll('td');
        for (const index of numericColumns) {
          const cell = cells[index];
          const placeholder = cell?.firstElementChild;
          expect(placeholder).not.toBeNull();
          if (!cell || !placeholder)
            throw new Error('Missing numeric placeholder');
          const box = placeholder.getBoundingClientRect();
          expect(box.width).toBeLessThanOrEqual(56);
          expect(box.right).toBeCloseTo(
            cell.getBoundingClientRect().right -
              Number.parseFloat(getComputedStyle(cell).paddingRight),
            0,
          );
        }
      }
      const beforeHeights = rowHeights();
      const beforeActions = actions('[data-skeleton-mask]');
      state.result = { data: { config }, isLoading: false };
      rerender(
        <div style={{ width: 960 }}>
          <Editor organizationId="org-1" />
        </div>,
      );
      expect(rows()).toHaveLength(count);
      expect(rowHeights()).toEqual(beforeHeights);
      expect(actions('button')).toEqual(beforeActions);
    },
  );
});
