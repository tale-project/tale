import { beforeEach, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { IssueImportContinuation } from './issue-import-continuation';

const state = vi.hoisted(() => ({
  canRun: true,
  mutate: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.canRun }),
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: [{ _id: 'p1', name: 'Engineering' }] }),
}));
vi.mock('../hooks/mutations', () => ({
  useStartAutomationRun: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => state.navigate,
}));

const props = {
  organizationId: 'org1',
  projectId: 'p1',
  automationSlug: 'github-import-issues',
  version: 2,
  mode: 'live' as const,
  cursor: 'next-page',
  input: { projectId: 'p1', owner: 'example', repo: 'app', limit: 10 },
  schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      owner: { type: 'string' },
      repo: { type: 'string' },
      labels: { type: 'string' },
      limit: { type: 'integer' },
      cursor: { type: 'string' },
    },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  state.canRun = true;
});

it('continues the pinned version, mode and project, keeps failures editable, then opens the new run', async () => {
  state.mutate.mockImplementationOnce((_args, callbacks) =>
    callbacks.onError(new Error('Connection unavailable')),
  );
  const { user } = render(<IssueImportContinuation {...props} />);
  await user.click(screen.getByRole('button', { name: 'Continue import' }));
  await user.click(screen.getByRole('button', { name: 'Run live' }));
  expect(state.mutate).toHaveBeenLastCalledWith(
    {
      organizationId: 'org1',
      projectId: 'p1',
      name: props.automationSlug,
      version: 2,
      mode: 'live',
      input: { ...props.input, cursor: 'next-page' },
    },
    expect.any(Object),
  );
  expect(
    screen.getByRole('textbox', { name: /GitHub repository/ }),
  ).toHaveValue('app');
  expect(state.navigate).not.toHaveBeenCalled();
  state.mutate.mockImplementationOnce((_args, callbacks) =>
    callbacks.onSuccess({ runId: 'run2' }),
  );
  await user.click(screen.getByRole('button', { name: 'Run live' }));
  expect(state.navigate).toHaveBeenCalledWith({
    to: '/dashboard/$id/automations/$automationSlug/runs/$runId',
    params: { id: 'org1', automationSlug: props.automationSlug, runId: 'run2' },
  });
});

it('does not offer a live continuation without the live-run capability', () => {
  state.canRun = false;
  render(<IssueImportContinuation {...props} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
