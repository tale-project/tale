// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, waitFor } from '@/test/utils/render';

import { ScheduleCreateDialog } from './schedule-create-dialog';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-123' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/slug-mutations', () => ({
  useCreateSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/actions', () => ({
  useGenerateCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/file-queries', () => ({
  useReadWorkflow: () => ({ data: undefined, isLoading: false }),
}));

describe('ScheduleCreateDialog', () => {
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
});
