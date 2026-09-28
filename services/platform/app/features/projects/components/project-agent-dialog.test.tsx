import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { toast } from '@tale/ui/use-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { ProjectAgentRow } from '../hooks/queries';
import {
  DOCUMENT_SKILL_SLUGS,
  ProjectAgentDialog,
} from './project-agent-dialog';

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

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

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

function renderDialog(agent: ProjectAgentRow, models = MODELS) {
  return render(
    <ProjectAgentDialog
      open
      onOpenChange={() => undefined}
      projectId={'p1' as string}
      organizationId="org-1"
      harnesses={[{ harness: 'claude-code', label: 'Claude Code' }]}
      models={models}
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
  it('finds a friendly-named model by its API id and saves its provider', async () => {
    const { user } = renderDialog(LEGACY_AGENT, [
      { ...MODELS[0], label: 'Claude Fable 5' },
      MODELS[1],
    ]);

    await user.click(screen.getByRole('button', { name: 'Model' }));
    await user.type(
      screen.getByRole('combobox', { name: 'Search models' }),
      'anthropic/claude-fable-5',
    );
    await user.click(screen.getByRole('option', { name: /Claude Fable 5/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/claude-fable-5',
        modelProvider: 'openrouter',
      }),
    );
  });

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

  it('names an archived project when the save is refused with PROJECT_ARCHIVED', async () => {
    // The guard used to answer PROJECT_FORBIDDEN, which this dialog folded
    // into the generic "Couldn't save the agent". The distinct code gets its
    // own sentence — restore the project first.
    updateAgent.mockRejectedValueOnce(
      new AppError({
        code: 'PROJECT_ARCHIVED',
        message: 'Project is archived',
      }),
    );
    const { user } = renderDialog(LEGACY_AGENT);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'This project is archived. Restore it to make changes.',
          variant: 'destructive',
        }),
      ),
    );
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

describe('ProjectAgentDialog document skills', () => {
  // What the project can see: two seeded document skills and a house skill.
  const VISIBLE_SKILLS = [
    { slug: 'docx', label: 'Word documents' },
    { slug: 'pptx', label: 'Presentations' },
    { slug: 'brief-summary', label: 'Brief summary' },
  ];

  function renderWithSkills(agent?: ProjectAgentRow) {
    return render(
      <ProjectAgentDialog
        open
        onOpenChange={() => undefined}
        projectId={'p1' as string}
        organizationId="org-1"
        harnesses={[{ harness: 'claude-code', label: 'Claude Code' }]}
        models={MODELS}
        skills={VISIBLE_SKILLS}
        connectors={[]}
        {...(agent !== undefined ? { agent } : {})}
      />,
    );
  }

  async function checkedState(
    user: ReturnType<typeof renderWithSkills>['user'],
    label: string,
  ) {
    await user.click(screen.getByRole('button', { name: /skills/i }));
    const item = await screen.findByRole('menuitemcheckbox', { name: label });
    const state = item.getAttribute('aria-checked');
    await user.keyboard('{Escape}');
    return state;
  }

  it('ticks the document skills the project can see on a new agent', async () => {
    const { user } = renderWithSkills();
    expect(await checkedState(user, 'Word documents')).toBe('true');
    expect(await checkedState(user, 'Presentations')).toBe('true');
    expect(await checkedState(user, 'Brief summary')).toBe('false');
  });

  it('never changes the equipment of an agent being edited', async () => {
    const { user } = renderWithSkills(LEGACY_AGENT);
    expect(await checkedState(user, 'Word documents')).toBe('false');
    expect(await checkedState(user, 'Presentations')).toBe('false');
  });

  it('names skills every organization is seeded with', () => {
    // The seed catalog the platform image copies into each new organization.
    const seedRoot = resolve(
      process.cwd(),
      '../../configs/platform/custom/skills',
    );
    for (const slug of DOCUMENT_SKILL_SLUGS) {
      expect(existsSync(resolve(seedRoot, slug, 'SKILL.md')), slug).toBe(true);
    }
  });
});
