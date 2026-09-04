// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { WorkflowSettings } from './workflow-settings';

const mockSetTrigger = vi.fn();
const mockDeleteTrigger = vi.fn();
const setProjects = { mutate: vi.fn(), isPending: false };

let triggersData:
  | Array<{
      name: string;
      kind: string;
      cron?: string;
      timezone?: string;
      hasToken: boolean;
      enabled: boolean;
    }>
  | undefined;
let boundData: string[] | undefined = [];

vi.mock('../hooks/queries', () => ({
  useAutomationTriggers: () => ({ data: triggersData }),
  useAutomationProjects: () => ({ data: boundData }),
}));

vi.mock('../hooks/mutations', () => ({
  useSetAutomationTrigger: () => ({
    mutate: mockSetTrigger,
    isPending: false,
  }),
  useDeleteAutomationTrigger: () => ({
    mutate: mockDeleteTrigger,
    isPending: false,
  }),
  useSetAutomationProjects: () => setProjects,
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({
    projects: [
      { _id: 'proj_1', name: 'Document desk' },
      { _id: 'proj_2', name: 'Getting started' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

describe('WorkflowSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggersData = [
      {
        name: 'digest',
        kind: 'schedule',
        cron: '0 */6 * * *',
        timezone: 'UTC',
        hasToken: false,
        enabled: true,
      },
    ];
    boundData = [];
  });

  it('renders one Save settings for the whole panel, not one per section', () => {
    render(<WorkflowSettings organizationId="org-1" name="digest" canEdit />);

    expect(
      screen.getAllByRole('button', { name: 'Save settings' }),
    ).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Remove trigger' }),
    ).toBeInTheDocument();
  });

  it('saves both dirty sections from the shared Save settings', async () => {
    render(<WorkflowSettings organizationId="org-1" name="digest" canEdit />);

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 9 * * 1');

    await userEvent.click(screen.getByRole('combobox', { name: 'Projects' }));
    await userEvent.click(
      screen.getByRole('option', { name: /Document desk/ }),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Save settings' }),
    );

    expect(mockSetTrigger).toHaveBeenCalled();
    expect(setProjects.mutate).toHaveBeenCalled();
  });
});
