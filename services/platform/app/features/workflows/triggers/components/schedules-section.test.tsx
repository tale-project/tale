// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { WfSchedule } from '../hooks/queries';
import { SchedulesSection } from './schedules-section';

// Regression coverage for #2613: the schedule list must show the bound
// project (or a clear "no project" state) and flag rows whose required
// workflow variables are still blank, instead of every row looking
// identical regardless of configuration state.

let mockSchedules: WfSchedule[] = [];
let mockInputSchema:
  | { properties: Record<string, unknown>; required?: string[] }
  | undefined;

vi.mock('../hooks/queries', () => ({
  useSchedules: () => ({ schedules: mockSchedules, isLoading: false }),
}));

vi.mock('../hooks/slug-mutations', () => ({
  useToggleSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/actions', () => ({
  useGenerateCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/file-queries', () => ({
  useReadWorkflow: () => ({
    data: mockInputSchema
      ? {
          ok: true,
          config: {
            steps: [
              { stepType: 'start', config: { inputSchema: mockInputSchema } },
            ],
          },
        }
      : undefined,
    isLoading: false,
  }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({
    projects: [{ _id: 'project-1', name: 'Acme Website' }],
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function scheduleRow(overrides: Partial<WfSchedule> = {}): WfSchedule {
  return {
    _id: 'sched-1',
    cronExpression: '0 * * * *',
    timezone: 'UTC',
    isActive: true,
    createdBy: 'ada@example.com',
    lastTriggeredAt: undefined,
    projectId: undefined,
    variables: undefined,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixture narrows to the Doc<'wfSchedules'> shape the section reads
    ...overrides,
  } as WfSchedule;
}

function renderSection() {
  return render(
    <SchedulesSection
      workflowRootId="root-1"
      organizationId="org-1"
      workflowSlug="my-workflow"
    />,
  );
}

describe('SchedulesSection', () => {
  afterEach(() => {
    mockSchedules = [];
    mockInputSchema = undefined;
  });

  describe('project column and needs-configuration badge (#2613)', () => {
    it('shows "No project" for a schedule with no bound project', () => {
      mockSchedules = [scheduleRow({ projectId: undefined })];
      renderSection();

      expect(screen.getByText('No project')).toBeInTheDocument();
    });

    it("shows the bound project's name", () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixture id, not a real Convex Id
      mockSchedules = [scheduleRow({ projectId: 'project-1' as never })];
      renderSection();

      expect(screen.getByText('Acme Website')).toBeInTheDocument();
      expect(screen.queryByText('No project')).not.toBeInTheDocument();
    });

    it('flags a schedule missing a required workflow variable', () => {
      mockInputSchema = {
        properties: { owner: { type: 'string' } },
        required: ['owner'],
      };
      mockSchedules = [scheduleRow({ variables: {} })];
      renderSection();

      expect(screen.getByText('Needs configuration')).toBeInTheDocument();
    });

    it('does not flag a schedule whose required variables are all set', () => {
      mockInputSchema = {
        properties: { owner: { type: 'string' } },
        required: ['owner'],
      };
      mockSchedules = [scheduleRow({ variables: { owner: 'acme' } })];
      renderSection();

      expect(screen.queryByText('Needs configuration')).not.toBeInTheDocument();
    });

    it("counts the schedule's own bound project as satisfying a required projectId", () => {
      mockInputSchema = {
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
      };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixture id, not a real Convex Id
      mockSchedules = [
        scheduleRow({ projectId: 'project-1' as never, variables: {} }),
      ];
      renderSection();

      expect(screen.queryByText('Needs configuration')).not.toBeInTheDocument();
    });

    // Regression: the missing-fields detail used to live only in a native
    // `title=` attribute on the badge — unreachable by keyboard and never
    // announced by screen readers. It must now be exposed by a focusable
    // control whose accessible name carries the detail text.
    it('exposes the missing-fields detail via a keyboard-focusable, announced control', () => {
      mockInputSchema = {
        properties: { owner: { type: 'string' } },
        required: ['owner'],
      };
      mockSchedules = [scheduleRow({ variables: {} })];
      renderSection();

      const detailButton = screen.getByRole('button', {
        name: 'Missing required variables: owner',
      });
      detailButton.focus();
      expect(detailButton).toHaveFocus();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with a mix of configured and unconfigured schedules', async () => {
      mockInputSchema = {
        properties: { owner: { type: 'string' } },
        required: ['owner'],
      };
      mockSchedules = [
        scheduleRow({
          _id: 'sched-1' as Id<'wfSchedules'>,
          variables: {},
        }),
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixture id, not a real Convex Id
        scheduleRow({
          _id: 'sched-2' as Id<'wfSchedules'>,
          projectId: 'project-1' as never,
          variables: { owner: 'acme' },
        }),
      ];
      const { container } = renderSection();

      await checkAccessibility(container, {
        rules: { 'empty-table-header': { enabled: false } },
      });
    });
  });
});
