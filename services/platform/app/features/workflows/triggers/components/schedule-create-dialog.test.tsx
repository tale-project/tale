// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { browserTimezone } from '../utils/timezone-options';
import { ScheduleCreateDialog } from './schedule-create-dialog';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-123' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const createScheduleMock = vi.fn();
const updateScheduleMock = vi.fn();

vi.mock('../hooks/slug-mutations', () => ({
  useCreateSchedule: () => ({
    mutateAsync: createScheduleMock,
    isPending: false,
  }),
  useUpdateSchedule: () => ({
    mutateAsync: updateScheduleMock,
    isPending: false,
  }),
}));

vi.mock('../hooks/actions', () => ({
  useGenerateCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Mutable so individual tests (#2608, #2614) can simulate a workflow whose
// start step declares an `inputSchema` — same shape `useReadWorkflow` itself
// returns, read through `useWorkflowInputSchema`.
let mockInputSchema:
  | { properties: Record<string, unknown>; required?: string[] }
  | undefined;

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
  useProjects: () => ({ projects: [] }),
}));

describe('ScheduleCreateDialog', () => {
  afterEach(() => {
    mockInputSchema = undefined;
    createScheduleMock.mockClear();
    updateScheduleMock.mockClear();
  });

  describe('accessibility', () => {
    it('passes axe audit for create mode', async () => {
      const { container } = render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          workflowSlug="my-workflow"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit for edit mode', async () => {
      const { container } = render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          workflowSlug="my-workflow"
          schedule={{
            _id: 'schedule-1',
            cronExpression: '0 * * * *',
            timezone: 'UTC',
          }}
        />,
      );
      await checkAccessibility(container);
    });
  });

  // Regression test for #1426: Create must stay disabled until a valid
  // cron expression is entered.
  describe('submit gating (#1426)', () => {
    it('keeps Create disabled until a valid cron expression is entered', async () => {
      const { user } = render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          workflowSlug="my-workflow"
        />,
      );

      // The dialog renders in a Radix portal (document.body).
      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      expect(submit).toBeDisabled();

      const cronInput = document.querySelector(
        'input[name="cronExpression"]',
      ) as HTMLInputElement;
      await user.type(cronInput, '0 * * * *');

      await waitFor(() => expect(submit).toBeEnabled());
    });

    it('keeps Create disabled for an invalid cron expression', async () => {
      const { user } = render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          workflowSlug="my-workflow"
        />,
      );

      // The dialog renders in a Radix portal (document.body).
      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      const cronInput = document.querySelector(
        'input[name="cronExpression"]',
      ) as HTMLInputElement;
      await user.type(cronInput, 'not-a-cron');

      await waitFor(() => expect(submit).toBeDisabled());
    });
  });

  // Regression coverage for #2608: the dialog used to skip
  // `getMissingRequiredFields` entirely on save, so a required schema field
  // left blank was stored as `""` and the schedule still fired.
  describe('required schedule variables gate save (#2608, #2614)', () => {
    it('renders a required field as a structured control and blocks Save until it is filled', async () => {
      mockInputSchema = {
        properties: {
          repoName: { type: 'string', description: 'Repository to scan' },
        },
        required: ['repoName'],
      };

      const { user } = render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          workflowSlug="my-workflow"
        />,
      );

      const cronInput = document.querySelector(
        'input[name="cronExpression"]',
      ) as HTMLInputElement;
      await user.type(cronInput, '0 * * * *');

      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      // A valid cron alone isn't enough — the required variable is still blank.
      await waitFor(() => expect(submit).toBeDisabled());

      await user.type(screen.getByLabelText(/repo name/i), 'tale-project/tale');

      await waitFor(() => expect(submit).toBeEnabled());
      // The schema's `description` renders as help now that the field is no
      // longer flagged missing (the error message takes priority over help
      // while a required field is blank — see `Field`).
      expect(screen.getByText('Repository to scan')).toBeInTheDocument();
    });

    it('blocks save when the raw-JSON editor still has a blank required field', async () => {
      mockInputSchema = {
        properties: {
          // An object property can't render as a plain control, so the
          // dialog falls back to the raw-JSON editor for this schedule.
          meta: { type: 'object' },
        },
        required: ['meta'],
      };

      const { user } = render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          workflowSlug="my-workflow"
        />,
      );

      const cronInput = document.querySelector(
        'input[name="cronExpression"]',
      ) as HTMLInputElement;
      await user.type(cronInput, '0 * * * *');

      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      // `buildInputTemplateFromSchema` seeds `meta: {}`, which is still
      // "unconfigured" — Save must stay blocked (this is the exact #2608 bug).
      await waitFor(() => expect(submit).toBeDisabled());

      await user.click(submit);
      expect(createScheduleMock).not.toHaveBeenCalled();
    });
  });

  // Regression coverage for #2667: the dialog used to hardcode `timezone:
  // 'UTC'` on both create and update, silently discarding any chosen zone.
  describe('timezone picker (#2667)', () => {
    it('defaults a new schedule to the browser timezone, not a hardcoded UTC', () => {
      render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          workflowSlug="my-workflow"
        />,
      );

      const combobox = screen.getByRole('combobox', { name: /timezone/i });
      expect(combobox).toHaveTextContent(browserTimezone());
    });

    it("preserves an existing schedule's own timezone instead of resetting it to UTC", () => {
      render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          workflowSlug="my-workflow"
          schedule={{
            _id: 'schedule-1',
            cronExpression: '0 * * * *',
            timezone: 'America/New_York',
          }}
        />,
      );

      const combobox = screen.getByRole('combobox', { name: /timezone/i });
      expect(combobox).toHaveTextContent('America/New_York');
    });
  });
});
