import { describe, expect, it, vi } from 'vitest';

import type { NodeDef } from '@/lib/engine/core/types';
import { render, screen } from '@/tests/utils/render';

import { AgentNodeFields } from './agent-node-fields';

// The picker's roster: the SAME model id served twice — the subscription copy
// carries the bare vendor id, the OpenRouter copy the vendor-prefixed one.
// This is exactly the constellation where a pinless pick used to LOOK like
// the subscription entry while the run's walk picked the other provider.
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
      ],
    },
  }),
  useAgentSecrets: () => ({ data: [] }),
}));

vi.mock('../hooks/queries', () => ({
  useAutomationCapabilities: () => ({
    data: { skills: [], connectors: [] },
  }),
}));

// The secrets manager talks to Convex actions on mount; the model pin story
// never touches it.
vi.mock('@/app/features/projects/components/agent-secrets-field', () => ({
  AgentSecretsField: () => null,
}));

// The runtime's own answer for a pinless pick — what the walk would use NOW.
const { previewState } = vi.hoisted(() => ({
  previewState: { data: undefined as unknown },
}));
vi.mock('@/app/features/projects/hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: previewState.data }),
}));

function renderFields(node: NodeDef, onChange = vi.fn()) {
  const view = render(
    <AgentNodeFields
      organizationId="org-1"
      node={node}
      readOnly={false}
      onChange={onChange}
    />,
  );
  return { ...view, onChange };
}

const PINLESS: NodeDef = {
  id: 'agent',
  type: 'agent',
  model: 'claude-fable-5',
};

describe('AgentNodeFields model pin', () => {
  it('shows the provider a run would ACTUALLY use for a pinless pick', () => {
    previewState.data = {
      ok: true,
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-fable-5',
      lane: 'gateway',
    };
    renderFields(PINLESS);

    // The trigger sits on the walk's answer (the OpenRouter copy), never on
    // the id-lookalike subscription entry the old fallback preselected.
    expect(screen.getByText('anthropic/claude-fable-5')).toBeVisible();
    expect(
      screen.getByText(/runs currently resolve to OpenRouter/),
    ).toBeVisible();
  });

  it('says it is still resolving before the runtime has answered', () => {
    previewState.data = undefined;
    renderFields(PINLESS);
    expect(
      screen.getByText(/checking which provider runs would use/),
    ).toBeVisible();
  });

  it('surfaces the resolver’s own refusal when nothing serves the model', () => {
    previewState.data = {
      ok: false,
      reason: 'no configured provider serves "claude-fable-5"',
    };
    renderFields(PINLESS);
    expect(
      screen.getByText(/no configured provider serves "claude-fable-5"/),
    ).toBeVisible();
  });

  it('stays quiet once the pick carries its provider', () => {
    previewState.data = undefined;
    renderFields({
      id: 'agent',
      type: 'agent',
      model: 'claude-fable-5',
      modelProvider: 'anthropic',
    });

    expect(screen.getByText('claude-fable-5')).toBeVisible();
    expect(screen.queryByText(/without a pinned provider/)).toBeNull();
  });
});
