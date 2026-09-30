// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { render, screen } from '@/tests/utils/render';

import { TaskRunDetailsDialog } from './task-run-details-dialog';

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

vi.mock('@/app/features/automations/hooks/queries', () => ({
  useAutomationRun: () => ({
    data: { _id: 'run-1', status: 'succeeded', trace: [] },
  }),
  useAutomation: () => ({ data: undefined }),
}));

vi.mock('@/app/features/automations/components/run-step-timeline', () => ({
  RunStepTimeline: () => <ol aria-label="steps" />,
}));

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

// The dialog is the quick look any project member gets; the full run page it
// links to is an automation page, which only Owners, Admins and Developers
// may use.
function renderDialog(role: Role) {
  return render(
    <AbilityContext.Provider value={abilities[role]}>
      <TaskRunDetailsDialog
        organizationId="org-1"
        projectId="proj-1"
        automationSlug="mail-sync"
        runId="run-1"
        name="Mail sync"
        live={false}
        open
        onOpenChange={() => {}}
      />
    </AbilityContext.Provider>,
  );
}

describe('TaskRunDetailsDialog', () => {
  it('links a developer to the full run page', () => {
    renderDialog('developer');

    expect(screen.getByRole('list', { name: 'steps' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'tasks.run.openFull' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId',
    );
  });

  it.each(['editor', 'member'] as const)(
    'shows the %s role the steps without a link into Automations',
    (role) => {
      renderDialog(role);

      expect(screen.getByRole('list', { name: 'steps' })).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'tasks.run.openFull' }),
      ).not.toBeInTheDocument();
    },
  );
});
