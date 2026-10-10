import { toast } from '@tale/ui/use-toast';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import type { ProjectAgentRow } from '../hooks/queries';
import { ProjectAgentDialog } from './project-agent-dialog';

const { createAgent, updateAgent, previewState } = vi.hoisted(() => ({
  createAgent: vi.fn().mockResolvedValue('agent-new'),
  updateAgent: vi.fn().mockResolvedValue(undefined),
  previewState: { data: undefined as unknown },
}));

vi.mock('../hooks/mutations', () => ({
  useCreateProjectAgent: () => ({ mutateAsync: createAgent }),
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

function renderDialog(
  agent: ProjectAgentRow,
  models = MODELS,
  onOpenChange = vi.fn(),
) {
  return render(
    <ProjectAgentDialog
      open
      onOpenChange={onOpenChange}
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
  createAgent.mockClear();
  updateAgent.mockClear();
  previewState.data = undefined;
});

describe('ProjectAgentDialog mention handle', () => {
  it('tells how the agent being edited is mentioned', () => {
    renderDialog({
      ...LEGACY_AGENT,
      name: 'My Opus Agent #3',
      handle: 'my-opus-agent-3',
    });
    expect(
      screen.getByText(
        'Mention it with @my-opus-agent-3. Renaming the agent changes this.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing about a handle while creating', () => {
    render(
      <ProjectAgentDialog
        open
        onOpenChange={vi.fn()}
        projectId="p1"
        organizationId="org-1"
        harnesses={[{ harness: 'claude-code', label: 'Claude Code' }]}
        models={MODELS}
        skills={[]}
        connectors={[]}
      />,
    );
    expect(screen.queryByText(/^Mention it with @/)).not.toBeInTheDocument();
  });
});

describe('ProjectAgentDialog pending save', () => {
  it('blocks edits until the submitted instructions finish saving', async () => {
    const pending = Promise.withResolvers<void>();
    updateAgent.mockReturnValueOnce(pending.promise);
    const onOpenChange = vi.fn();
    const { user } = renderDialog(LEGACY_AGENT, MODELS, onOpenChange);
    const instructions = screen.getByRole('textbox', { name: /Instructions/ });
    await user.type(instructions, 'Submitted instructions');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: 'Submitted instructions' }),
    );
    expect(instructions).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /Name/ })).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: /Agent runtime/ }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Model/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /skills/i })).toBeDisabled();
    await user.type(instructions, 'Later unsaved instructions');
    expect(instructions).toHaveValue('Submitted instructions');
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => pending.resolve());
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('restores editing and retains the draft after a duplicate-name refusal', async () => {
    const pending = Promise.withResolvers<void>();
    updateAgent.mockReturnValueOnce(pending.promise);
    const onOpenChange = vi.fn();
    const { user } = renderDialog(LEGACY_AGENT, MODELS, onOpenChange);
    const name = screen.getByRole('textbox', { name: /Name/ });
    const instructions = screen.getByRole('textbox', { name: /Instructions/ });
    await user.clear(name);
    await user.type(name, 'Duplicate name');
    await user.type(instructions, 'Keep this draft');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(instructions).toBeDisabled();

    await act(async () => {
      pending.reject(new AppError({ code: 'PROJECT_AGENT_NAME_TAKEN' }));
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(name).toHaveValue('Duplicate name');
    expect(name).toBeEnabled();
    expect(
      screen.getByText('Another agent in this project already has that name.'),
    ).toBeVisible();
    expect(instructions).toBeEnabled();
    await user.type(instructions, ' and continue');
    expect(instructions).toHaveValue('Keep this draft and continue');
  });

  it('sends empty instructions through the existing clearing payload', async () => {
    const { user } = renderDialog({
      ...LEGACY_AGENT,
      instructions: 'Old text',
    });
    await user.clear(screen.getByRole('textbox', { name: /Instructions/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateAgent).toHaveBeenCalledTimes(1);
    expect(updateAgent.mock.calls[0]?.[0]).not.toHaveProperty('instructions');
  });
});

describe('ProjectAgentDialog create', () => {
  it('hands the new agent to a caller that goes on to use it', async () => {
    const pending = Promise.withResolvers<string>();
    createAgent.mockReturnValueOnce(pending.promise);
    const onCreated = vi.fn();
    const { user } = render(
      <ProjectAgentDialog
        open
        onOpenChange={() => undefined}
        projectId={'p1' as string}
        organizationId="org-1"
        harnesses={[{ harness: 'claude-code', label: 'Claude Code' }]}
        models={MODELS}
        skills={[]}
        connectors={[]}
        onCreated={onCreated}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Analyst');
    await user.click(screen.getByRole('combobox', { name: /Agent runtime/ }));
    await user.click(
      await screen.findByRole('option', { name: 'Claude Code' }),
    );
    await user.click(screen.getByRole('button', { name: /^Model/ }));
    await user.click(
      await screen.findByRole('option', { name: /anthropic\/claude-fable-5/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Create agent' }));
    expect(
      screen.getByRole('textbox', { name: /Instructions/ }),
    ).toBeDisabled();
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => pending.resolve('agent-new'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('agent-new'));
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        name: 'Analyst',
        harness: 'claude-code',
      }),
    );
  });
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

  function dialogWithSkills(
    overrides: Partial<ComponentProps<typeof ProjectAgentDialog>> = {},
  ) {
    return (
      <ProjectAgentDialog
        open
        onOpenChange={() => undefined}
        projectId={'p1' as string}
        organizationId="org-1"
        harnesses={[{ harness: 'claude-code', label: 'Claude Code' }]}
        models={MODELS}
        skills={VISIBLE_SKILLS}
        connectors={[]}
        {...overrides}
      />
    );
  }

  function renderWithSkills(agent?: ProjectAgentRow) {
    return render(dialogWithSkills(agent ? { agent } : {}));
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

  it('offers the delegation tool to a project agent, unticked', async () => {
    const { user } = renderWithSkills();
    await user.click(screen.getByRole('button', { name: /skills/i }));
    const item = await screen.findByRole('menuitemcheckbox', {
      name: /Start other agents on tasks/,
    });
    expect(item).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Escape}');
  });

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

  it.each([{ skills: [] }, { skills: [VISIBLE_SKILLS[2]] }])(
    'does not add defaults after a loaded catalog had no document skills: %j',
    async ({ skills }) => {
      const { user, rerender } = render(dialogWithSkills({ skills }));
      rerender(dialogWithSkills());

      expect(await checkedState(user, 'Word documents')).toBe('false');
      expect(await checkedState(user, 'Presentations')).toBe('false');
    },
  );

  it('keeps an unticked default across refreshes, then resets on reopening', async () => {
    const { user, rerender } = renderWithSkills();
    await user.click(screen.getByRole('button', { name: /skills/i }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Word documents' }),
    );
    await user.keyboard('{Escape}');

    rerender(dialogWithSkills({ skills: [...VISIBLE_SKILLS] }));
    expect(await checkedState(user, 'Word documents')).toBe('false');

    rerender(dialogWithSkills({ open: false }));
    rerender(dialogWithSkills());
    expect(await checkedState(user, 'Word documents')).toBe('true');
  });

  it('waits for the first catalog and keeps equipment chosen while it loads', async () => {
    const connectors = [{ slug: 'review-files', label: 'Review files' }];
    const { user, rerender } = render(
      dialogWithSkills({ skills: undefined, connectors }),
    );
    await user.click(screen.getByRole('button', { name: /skills/i }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Review files' }),
    );
    await user.keyboard('{Escape}');

    rerender(dialogWithSkills({ connectors }));
    expect(await checkedState(user, 'Word documents')).toBe('true');
    expect(await checkedState(user, 'Presentations')).toBe('true');
    expect(await checkedState(user, 'Review files')).toBe('true');
  });

  it('keeps an edited agent unchanged when the catalog arrives later', async () => {
    const agent = { ...LEGACY_AGENT, skills: ['brief-summary'] };
    const { user, rerender } = render(
      dialogWithSkills({ agent, skills: undefined }),
    );

    rerender(dialogWithSkills({ agent }));
    expect(await checkedState(user, 'Word documents')).toBe('false');
    expect(await checkedState(user, 'Presentations')).toBe('false');
    expect(await checkedState(user, 'Brief summary')).toBe('true');
  });
});
