import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ProjectAgentRow } from '../hooks/queries';
import { ProjectAgentDialog } from './project-agent-dialog';

const { updateAgent, previewState } = vi.hoisted(() => ({
  updateAgent: vi.fn().mockResolvedValue(undefined),
  previewState: { data: undefined as unknown },
}));

vi.mock('../hooks/mutations', () => ({
  useCreateProjectAgent: () => ({ mutateAsync: vi.fn() }),
  useUpdateProjectAgent: () => ({ mutateAsync: updateAgent }),
}));

vi.mock('../hooks/queries', () => ({
  useAgentSecrets: () => ({ data: [] }),
}));

// The runtime's own answer for a pinless pick — what the walk would use NOW.
vi.mock('../hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: previewState.data }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

// FormDialog reads the route for the org id; there is no router in the test.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ id: 'org-1' }),
}));

// The secrets manager talks to Convex actions on mount; the model pin story
// never touches it.
vi.mock('./agent-secrets-field', () => ({
  AgentSecretsField: () => null,
}));

// The same model id served twice — the constellation where a pinless row
// used to LOOK like the subscription entry while a run billed the other lane.
const MODELS = [
  {
    id: 'anthropic/claude-fable-5',
    label: 'anthropic/claude-fable-5',
    providerSlug: 'openrouter',
    providerLabel: 'OpenRouter',
  },
  {
    id: 'claude-fable-5',
    label: 'claude-fable-5',
    providerSlug: 'anthropic',
    providerLabel: 'Anthropic',
    subscription: { harness: 'claude-code' },
  },
];

// A row saved before picks carried providers: model only, no modelProvider.
const LEGACY_AGENT = {
  _id: 'agent-1',
  name: 'PR reviewer',
  harness: 'claude-code',
  model: 'claude-fable-5',
  skills: [],
  connectors: [],
} as unknown as ProjectAgentRow;

function renderDialog(agent: ProjectAgentRow) {
  return render(
    <ProjectAgentDialog
      open
      onOpenChange={() => undefined}
      projectId={'p1' as string}
      organizationId="org-1"
      harnesses={[{ harness: 'claude-code', label: 'Claude Code' }]}
      models={MODELS}
      skills={[]}
      connectors={[]}
      agent={agent}
    />,
  );
}

beforeEach(() => {
  updateAgent.mockClear();
  previewState.data = undefined;
});

describe('ProjectAgentDialog model pin', () => {
  it('shows the provider a run would ACTUALLY use for a pinless row', async () => {
    previewState.data = {
      ok: true,
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-fable-5',
      lane: 'gateway',
    };
    renderDialog(LEGACY_AGENT);

    // The trigger sits on the walk's answer (the OpenRouter copy), never on
    // the id-lookalike subscription entry the old fallback preselected.
    expect(await screen.findByText('anthropic/claude-fable-5')).toBeVisible();
    expect(
      screen.getByText(/runs currently resolve to OpenRouter/),
    ).toBeVisible();
  });

  it('keeps an untouched legacy row unpinned rather than adopting a guess', async () => {
    previewState.data = {
      ok: true,
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-fable-5',
      lane: 'gateway',
    };
    const { user } = renderDialog(LEGACY_AGENT);

    await screen.findByText(/runs currently resolve to OpenRouter/);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateAgent).toHaveBeenCalled();
    expect(updateAgent.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      'modelProvider',
    );
  });
});
