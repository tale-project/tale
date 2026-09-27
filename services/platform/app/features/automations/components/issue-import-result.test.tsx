import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { IssueImportResult } from './issue-import-result';

function renderWithRouter(children: ReactNode) {
  const routeTree = createRootRoute({ component: () => children });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}

const output = {
  imported: 2,
  created: 1,
  updated: 1,
  truncated: false,
  tasks: [
    { taskId: 'task-1', created: true },
    { taskId: 'task-2', created: false },
  ],
};

it.each(['github-import-issues', 'glitchtip-import-issues'])(
  'links %s results to their Tale tasks',
  async (automationSlug) => {
    renderWithRouter(
      <IssueImportResult
        organizationId="org-1"
        automationSlug={automationSlug}
        output={output}
        mock={false}
      />,
    );
    expect(
      await screen.findByText(
        'Processed issues: 2. New tasks: 1. Existing tasks: 1.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Open task task-1' }),
    ).toHaveAttribute('href', '/dashboard/org-1/tasks/task-1');
    expect(
      screen.getByRole('link', { name: 'Open task task-2' }),
    ).toHaveAttribute('href', '/dashboard/org-1/tasks/task-2');
  },
);

it.each([0, 1, 2])('renders count labels for %i processed issues', (count) => {
  render(
    <IssueImportResult
      organizationId="org-1"
      automationSlug="github-import-issues"
      output={{
        ...output,
        imported: count,
        created: count,
        updated: 0,
        tasks: [],
      }}
      mock
    />,
  );
  expect(
    screen.getByText(
      `Processed issues: ${count}. New tasks: ${count}. Existing tasks: 0.`,
    ),
  ).toBeVisible();
});

it('labels mock output without linking to nonexistent tasks and explains a partial import', () => {
  render(
    <IssueImportResult
      organizationId="org-1"
      automationSlug="github/import-issues"
      output={{ ...output, truncated: true }}
      mock
    />,
  );
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(
    screen.getByText(
      'This is a test result. No issues were fetched and no tasks were written.',
    ),
  ).toBeVisible();
  expect(screen.getByText(/More issues match/)).toBeVisible();
});

it('leaves customized or malformed output to the existing JSON viewer', () => {
  render(
    <IssueImportResult
      organizationId="org-1"
      automationSlug="github/import-issues"
      output={{ ...output, tasks: [{ taskId: null }] }}
      mock={false}
    />,
  );
  expect(screen.queryByText('Imported tasks')).not.toBeInTheDocument();
});
