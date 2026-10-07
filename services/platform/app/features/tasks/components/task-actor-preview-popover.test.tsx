// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { render, screen } from '@/tests/utils/render';

import { TaskActorName } from './task-actor-preview-popover';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => `tasks.${key}`,
  }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectHarnesses: () => ({ data: { harnesses: [], models: [] } }),
  useProjectCapabilityCatalog: () => ({ data: { skills: [], connectors: [] } }),
}));

vi.mock('@/app/features/projects/hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: undefined }),
}));

describe('TaskActorName', () => {
  it('renders a plain name when no preview is available', () => {
    render(<TaskActorName preview={null} name="Israel" />);
    expect(screen.getByText('Israel')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a deleted agent as plain historical text', () => {
    render(
      <TaskActorName
        name="Deleted agent"
        preview={{
          kind: 'agent',
          name: 'Deleted agent',
          viewTo: '/dashboard/$id',
          viewParams: { id: 'org_1' },
        }}
      />,
    );

    expect(screen.getByText('Deleted agent')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a preview trigger and its details for agent actors', async () => {
    const { user } = render(
      <TaskActorName
        name="Writer"
        preview={{
          kind: 'agent',
          name: 'Writer',
          agent: {
            name: 'Writer',
            organizationId: 'org_1',
            projectId: 'project_1',
            harness: 'codex',
            model: 'gpt-6.1',
            modelProvider: 'openai',
            skills: ['docx'],
            connectors: [],
            tools: [],
            instructions: 'Drafts copy.',
            managed: false,
          },
          viewTo: '/dashboard/$id',
          viewParams: { id: 'org_1' },
        }}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Writer' });
    expect(trigger).toBeInTheDocument();
    await user.hover(trigger);
    expect(
      await screen.findByText('tasks.agents.providerLabel'),
    ).toBeInTheDocument();
    expect(screen.getByText('gpt-6.1')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'tasks.timeline.viewMore' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('tasks.timeline.viewAgent'),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'tasks.timeline.viewMore' }),
    );
    expect(
      await screen.findByText('tasks.agents.detailsTitle'),
    ).toBeInTheDocument();
    expect(screen.getByText('Drafts copy.')).toBeInTheDocument();
  });
  it('keeps keyboard focus on View more and restores the trigger on Escape', async () => {
    const { user } = render(
      <TaskActorName
        name="Writer"
        preview={{
          kind: 'agent',
          name: 'Writer',
          agent: {
            name: 'Writer',
            organizationId: 'org_1',
            projectId: 'project_1',
            harness: 'codex',
            model: 'gpt-6.1',
            modelProvider: 'openai',
            skills: ['docx'],
            connectors: [],
            tools: [],
            instructions: 'Drafts copy.',
            managed: false,
          },
          viewTo: '/dashboard/$id',
          viewParams: { id: 'org_1' },
        }}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Writer' });
    await user.tab();
    expect(trigger).toHaveFocus();
    await screen.findByRole('button', { name: 'tasks.timeline.viewMore' });
    await user.tab();
    const viewMore = screen.getByRole('button', {
      name: 'tasks.timeline.viewMore',
    });
    expect(viewMore).toHaveFocus();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(viewMore).toBeInTheDocument();
    expect(viewMore).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(trigger).toHaveFocus();
      expect(
        screen.queryByRole('button', { name: 'tasks.timeline.viewMore' }),
      ).not.toBeInTheDocument();
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(
      screen.queryByRole('button', { name: 'tasks.timeline.viewMore' }),
    ).not.toBeInTheDocument();

    await user.tab({ shift: true });
    await user.tab();
    await screen.findByRole('button', { name: 'tasks.timeline.viewMore' });
    await user.tab();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText('tasks.agents.detailsTitle'),
    ).toBeInTheDocument();
  });
});

// One ability per platform role, built once: a context value constructed in
// JSX would be a fresh object on every render.
const abilities = {
  owner: defineAbilityFor('owner'),
  admin: defineAbilityFor('admin'),
  developer: defineAbilityFor('developer'),
  editor: defineAbilityFor('editor'),
  member: defineAbilityFor('member'),
};
type Role = keyof typeof abilities;

// A workflow's View link opens an automation page, which only Owners, Admins
// and Developers may use; everyone else keeps the name and description.
describe('TaskActorName for a workflow actor', () => {
  function renderWorkflow(role: Role) {
    return render(
      <AbilityContext.Provider value={abilities[role]}>
        <TaskActorName
          name="Mail sync"
          preview={{
            kind: 'workflow',
            name: 'Mail sync',
            description: 'Pulls new mail.',
            viewTo: '/dashboard/$id/automations/$automationSlug',
            viewParams: { id: 'org_1', automationSlug: 'mail-sync' },
          }}
        />
      </AbilityContext.Provider>,
    );
  }

  it('links a developer to the automation', async () => {
    const { user } = renderWorkflow('developer');
    await user.hover(screen.getByRole('button', { name: 'Mail sync' }));

    expect(
      await screen.findByRole('link', { name: 'tasks.timeline.viewWorkflow' }),
    ).toHaveAttribute('href', '/dashboard/$id/automations/$automationSlug');
  });

  it.each(['editor', 'member'] as const)(
    'offers the %s role no link into Automations',
    async (role) => {
      const { user } = renderWorkflow(role);
      await user.hover(screen.getByRole('button', { name: 'Mail sync' }));

      expect(await screen.findByText('Pulls new mail.')).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'tasks.timeline.viewWorkflow' }),
      ).not.toBeInTheDocument();
    },
  );
});
