import { ActiveEditorProvider } from '@tale/ui/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { AutomationGeneralTab } from './automation-general-tab';

const setTrigger = vi.fn();
const setProjects = vi.fn();
const ability = vi.hoisted(() => ({ canAuthor: true }));
const automation = vi.hoisted(() => ({
  deployedVersion: undefined as number | undefined,
}));

vi.mock('../hooks/queries', () => ({
  useAutomationTriggers: () => ({
    data: [
      {
        name: 'gmail-triage-inbox',
        kind: 'schedule',
        cron: '0 */6 * * *',
        timezone: 'UTC',
        hasToken: false,
        enabled: true,
      },
    ],
    isPending: false,
  }),
  useAutomationProjects: () => ({ data: [], isPending: false }),
  useAutomation: () => ({
    data: { deployedVersion: automation.deployedVersion },
    isPending: false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useSetAutomationTrigger: () => ({
    mutateAsync: setTrigger,
    isPending: false,
  }),
  useDeleteAutomationTrigger: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAutomationProjects: () => ({
    mutateAsync: setProjects,
    isPending: false,
  }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({
    projects: [{ _id: 'proj_1', name: 'Document desk' }],
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => ability.canAuthor,
    cannot: () => !ability.canAuthor,
  }),
  useAbilityLoading: () => false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  ability.canAuthor = true;
  automation.deployedVersion = undefined;
  setTrigger.mockResolvedValue({});
  setProjects.mockResolvedValue(undefined);
});

/** The tab under the detail shell, which mounts the editor registry. */
function renderGeneralTab() {
  return render(
    <ActiveEditorProvider>
      <AutomationGeneralTab
        organizationId="org-1"
        automationSlug="gmail-triage-inbox"
      />
    </ActiveEditorProvider>,
  );
}

describe('AutomationGeneralTab', () => {
  it("carries the automation's trigger and projects as sections", () => {
    renderGeneralTab();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Trigger' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Projects' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Cron')).toHaveValue('0 */6 * * *');
  });

  it('saves every edited section from one Save', async () => {
    const { user } = renderGeneralTab();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    const cron = screen.getByLabelText('Cron');
    await user.clear(cron);
    await user.type(cron, '0 9 * * 1');
    await user.click(screen.getByRole('combobox', { name: 'Projects' }));
    await user.click(screen.getByRole('option', { name: /Document desk/ }));
    await user.keyboard('{Escape}');
    await user.click(save);

    expect(setTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'gmail-triage-inbox',
        trigger: expect.objectContaining({ cron: '0 9 * * 1' }),
      }),
    );
    // Sections save one after another, so a failure keeps the rest dirty.
    await waitFor(() => {
      expect(setProjects).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'gmail-triage-inbox',
          projectIds: ['proj_1'],
        }),
      );
    });
  });

  it('tells the trigger whether a version is deployed', () => {
    const { unmount } = renderGeneralTab();
    expect(
      screen.getByText(/Won't start until a version is deployed/),
    ).toBeVisible();
    unmount();

    automation.deployedVersion = 1;
    renderGeneralTab();
    expect(screen.getByText(/Next run/)).toBeVisible();
    expect(screen.queryByText(/deployed/)).toBeNull();
  });

  it('shows members the settings with no way to change them', () => {
    ability.canAuthor = false;
    renderGeneralTab();
    expect(screen.getByLabelText('Cron')).toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove trigger' }),
    ).not.toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = renderGeneralTab();
    await checkAccessibility(container);
  });
});
