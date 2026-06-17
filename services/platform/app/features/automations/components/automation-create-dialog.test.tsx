// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, waitFor } from '@/tests/utils/render';

import { CreateAutomationDialog } from './automation-create-dialog';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/file-mutations', () => ({
  useSaveWorkflow: () => ({ mutateAsync: vi.fn() }),
  useInvalidateWorkflows: () => vi.fn(),
  useInstallWorkflow: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/file-queries', () => ({
  useListWorkflows: () => ({ workflows: [], isLoading: false }),
}));

describe('CreateAutomationDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CreateAutomationDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await checkAccessibility(container);
    });
  });

  // Regression test for #1425: Continue must stay disabled until the
  // required name field is filled.
  describe('submit gating (#1425)', () => {
    it('keeps Continue disabled until the name is filled', async () => {
      const { user } = render(
        <CreateAutomationDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="test-org-id"
        />,
      );

      // The dialog renders in a Radix portal (document.body), not inside
      // the render container.
      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      expect(submit).toBeDisabled();

      const nameInput = document.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement;
      await user.type(nameInput, 'My Automation');

      await waitFor(() => expect(submit).toBeEnabled());
    });
  });
});
