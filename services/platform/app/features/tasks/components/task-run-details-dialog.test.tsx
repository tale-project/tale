// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AbilityContext } from '@/app/context/ability-context';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { render, screen } from '@/tests/utils/render';

import { TaskRunDetailsDialog } from './task-run-details-dialog';

const reads = vi.hoisted(() => ({
  run: vi.fn(),
  automation: vi.fn(),
  runData: {
    _id: 'run-1',
    version: 7,
    status: 'succeeded',
    trace: [],
  } as unknown,
}));

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
  useAutomationRun: (...args: unknown[]) => {
    reads.run(...args);
    return { data: reads.runData };
  },
  useAutomation: (...args: unknown[]) => {
    reads.automation(...args);
    return { data: undefined };
  },
}));

beforeEach(() => {
  reads.run.mockClear();
  reads.automation.mockClear();
  reads.runData = { _id: 'run-1', version: 7, status: 'succeeded', trace: [] };
});

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
function renderDialog(role: Role, open = true) {
  return render(
    <AbilityContext.Provider value={abilities[role]}>
      <TaskRunDetailsDialog
        organizationId="org-1"
        projectId="proj-1"
        automationSlug="mail-sync"
        runId="run-1"
        name="Mail sync"
        live={false}
        open={open}
        onOpenChange={() => {}}
      />
    </AbilityContext.Provider>,
  );
}

describe('TaskRunDetailsDialog', () => {
  it('creates no run or automation reads while closed', () => {
    renderDialog('developer', false);
    expect(reads.run).not.toHaveBeenCalled();
    expect(reads.automation).not.toHaveBeenCalled();
  });

  it('waits for the run before reading the version it actually executed', () => {
    reads.runData = undefined;
    const { unmount } = renderDialog('developer');
    expect(reads.run).toHaveBeenCalledWith('org-1', 'run-1');
    expect(reads.automation).not.toHaveBeenCalled();
    unmount();

    reads.runData = {
      _id: 'run-1',
      version: 7,
      status: 'succeeded',
      trace: [],
    };
    renderDialog('developer');
    expect(reads.automation).toHaveBeenCalledWith('org-1', 'mail-sync', 7);
  });

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
