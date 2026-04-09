// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

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

describe('ScheduleCreateDialog', () => {
  afterEach(cleanup);

  describe('accessibility', () => {
    it('passes axe audit for create mode', async () => {
      const { container } = render(
        <ScheduleCreateDialog
          open={true}
          onOpenChange={vi.fn()}
          workflowRootId="wf-root-1"
          organizationId="test-org-id"
          orgSlug="default"
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
          orgSlug="default"
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
});
