import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { BlankAutomationDialog } from './blank-automation-dialog';

// The picker's roster: the SAME model served by a direct OpenRouter key and
// an Anthropic subscription (lookalike ids), plus a subscription entry bound
// to another harness. The wizard used to collapse options by id and store a
// bare model string — the saved node then resolved to whichever provider the
// walk reached first, never the one picked on screen.
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectHarnesses: () => ({
    data: {
      harnesses: [{ harness: 'claude-code', label: 'Claude Code' }],
      models: [
        {
          id: 'anthropic/claude-fable-5',
          label: 'anthropic/claude-fable-5',
          providerSlug: 'openrouter',
          providerLabel: 'OpenRouter',
          credential: { authMethod: 'api-key' },
        },
        {
          id: 'claude-fable-5',
          label: 'claude-fable-5',
          providerSlug: 'anthropic',
          providerLabel: 'Anthropic',
          credential: {
            authMethod: 'subscription-broker',
            constraints: { harness: 'claude-code' },
          },
        },
        {
          id: 'gpt-6-codex',
          label: 'gpt-6-codex',
          providerSlug: 'openai',
          providerLabel: 'OpenAI',
          credential: {
            authMethod: 'subscription-key',
            constraints: { harness: 'codex' },
          },
        },
      ],
    },
    isError: false,
  }),
  useAgentSecrets: () => ({ data: [] }),
}));

vi.mock('../hooks/queries', () => ({
  useAutomationCapabilities: () => ({
    data: { skills: [], connectors: [] },
  }),
}));

// The secrets manager talks to backend actions on mount; the model pin story
// never touches it.
vi.mock('@/app/features/projects/components/agent-secrets-field', () => ({
  AgentSecretsField: () => null,
}));

const { saveAutomation, setTrigger, navigate } = vi.hoisted(() => ({
  saveAutomation: vi.fn().mockResolvedValue({ name: 'triage' }),
  setTrigger: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useSaveAutomation: () => ({ mutateAsync: saveAutomation }),
  useSetAutomationTrigger: () => ({ mutateAsync: setTrigger }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: 'org-1' }),
}));

function renderDialog() {
  return render(
    <BlankAutomationDialog
      organizationId="org-1"
      open
      onOpenChange={vi.fn()}
    />,
  );
}

describe('BlankAutomationDialog model pin', () => {
  it('offers one option per (provider, model) pair, harness-filtered', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: /Agent model/i }));

    // Both copies stay separately pickable — the id-keyed dedupe is gone —
    // and the subscription copy names its serving lane.
    expect(
      screen.getByRole('option', { name: /anthropic\/claude-fable-5/ }),
    ).toBeVisible();
    const subscriptionRow = screen.getByRole('option', {
      name: /^claude-fable-5/,
    });
    expect(subscriptionRow).toBeVisible();
    expect(subscriptionRow.textContent).toContain('Anthropic · Subscription');
    // The scaffolded node runs on the DEFAULT harness (claude-code), so a
    // subscription entry bound to another harness is not offered.
    expect(screen.queryByRole('option', { name: /gpt-6-codex/ })).toBeNull();
  });

  it('stores the picked (model, modelProvider) pair on the scaffolded node', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText(/Name/i), 'Triage');
    await user.click(screen.getByRole('button', { name: /Agent model/i }));
    await user.click(screen.getByRole('option', { name: /^claude-fable-5/ }));
    await user.type(
      screen.getByLabelText(/What should it do\?/i),
      'Scan issues',
    );
    await user.click(screen.getByRole('button', { name: /Next/i }));
    await user.click(
      screen.getByRole('button', { name: /Create automation/i }),
    );

    expect(saveAutomation).toHaveBeenCalledTimes(1);
    const document = saveAutomation.mock.calls[0]?.[0]?.automation;
    expect(document?.nodes?.[0]).toMatchObject({
      model: 'claude-fable-5',
      modelProvider: 'anthropic',
    });
  });
});
