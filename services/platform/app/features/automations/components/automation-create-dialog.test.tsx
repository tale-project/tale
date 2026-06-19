// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { CreateAutomationDialog } from './automation-create-dialog';

const navigateSpy = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

// Controllable so a test can make the save reject (e.g. a name collision).
const saveWorkflowMock = vi.fn();
const installWorkflowMock = vi.fn();
vi.mock('../hooks/file-mutations', () => ({
  useSaveWorkflow: () => ({ mutateAsync: saveWorkflowMock }),
  useInvalidateWorkflows: () => vi.fn(),
  useInstallWorkflow: () => ({ mutateAsync: installWorkflowMock }),
}));

vi.mock('../hooks/file-queries', () => ({
  useListWorkflows: () => ({ workflows: [], isLoading: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  saveWorkflowMock.mockResolvedValue({ hash: 'h' });
  installWorkflowMock.mockResolvedValue({ hash: 'h' });
});

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

  // Migrated from the automation-editor E2E "creates a blank automation and
  // lands in the editor". The E2E's full chain (dropdown -> Blank menuitem ->
  // dialog, then real install + real Router nav + canvas mount) needs a live
  // backend and TanStack Router, which jsdom cannot reproduce. The genuinely
  // pure-UI core that survives at the component tier is: filling the name and
  // pressing Continue derives the slug from the name (nameToSlug) and navigates
  // to the editor route at that slug. We assert exactly that here.
  describe('blank create navigation', () => {
    it('navigates to the editor at the name-derived slug on Continue', async () => {
      navigateSpy.mockClear();
      const { user } = render(
        <CreateAutomationDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );

      // "Create automation" dialog title proves the blank create surface.
      expect(document.querySelector('[role="dialog"]')).toHaveAccessibleName(
        'Create automation',
      );

      const nameInput = document.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement;
      // Mixed case + spaces: nameToSlug must lowercase + hyphenate to the slug
      // the editor URL depends on (same invariant the E2E relies on).
      await user.type(nameInput, 'My New Automation');

      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      // Continue carries the resolved English label and is enabled once valid.
      expect(submit).toHaveTextContent('Continue');
      await waitFor(() => expect(submit).toBeEnabled());

      await user.click(submit);

      // Lands in the editor at /dashboard/$id/automations/$amId with the slug
      // derived from the name — the component-tier equivalent of the E2E's
      // waitForURL(/automations/<slug>/) assertion.
      await waitFor(() =>
        expect(navigateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            to: '/dashboard/$id/automations/$amId',
            params: { id: 'org-1', amId: 'my-new-automation' },
          }),
        ),
      );

      // Creating must flag the save as a create so the backend rejects a name
      // collision instead of silently overwriting.
      expect(saveWorkflowMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowSlug: 'my-new-automation',
          isNew: true,
        }),
      );
    });
  });

  // A name that collides with an existing workflow must be rejected inline,
  // not silently overwrite it. The backend throws DUPLICATE_NAME (isNew guard);
  // the dialog surfaces it as a field error and does NOT navigate away.
  describe('duplicate name', () => {
    it('shows a field error and does not navigate when the name already exists', async () => {
      navigateSpy.mockClear();
      saveWorkflowMock.mockRejectedValueOnce(
        new ConvexError({ code: 'DUPLICATE_NAME', message: 'exists' }),
      );

      const { user } = render(
        <CreateAutomationDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );

      const nameInput = document.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement;
      await user.type(nameInput, 'Existing Automation');

      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      // The duplicate-name field error appears…
      await waitFor(() =>
        expect(
          screen.getByText('An automation with this name already exists'),
        ).toBeInTheDocument(),
      );
      // …install never runs and the dialog stays put (no navigation).
      expect(installWorkflowMock).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });
});
