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
        id: 'trigger-1',
        name: 'gmail-triage-inbox',
        kind: 'schedule',
        cron: '0 */6 * * *',
        repeat: null,
        startDate: null,
        timezone: 'UTC',
        catchUp: 'latest',
        input: null,
        event: null,
        hasToken: false,
        enabled: true,
        nextRunAt: null,
        lastFiredAt: null,
        lastRunId: null,
        lastSkippedAt: null,
        lastSkipReason: null,
        lastSkipDetail: null,
        consecutiveFailures: 0,
        lastFailedAt: null,
        lastFailureCode: null,
        lastFailedRunId: null,
      },
    ],
    isPending: false,
  }),
  useAutomationProjects: () => ({ data: [], isPending: false }),
  useAutomation: () => ({
    data: { deployedVersion: automation.deployedVersion },
    isPending: false,
  }),
  // The deployed version's document the trigger's input is checked against.
  useDeployedAutomation: () => ({
    data: { document: { name: 'gmail-triage-inbox', nodes: [] } },
    isPending: false,
  }),
  useAutomationRun: () => ({ data: undefined, isPending: false }),
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
  useStartAutomationRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    // The pack's cron a repeat rule says exactly opens as that rule.
    expect(
      screen.getByRole('button', { name: /^Schedule: Every 6 hours/ }),
    ).toBeVisible();
  });

  it('saves every edited section from one Save', async () => {
    const { user } = renderGeneralTab();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Cron (advanced)' }));
    const cron = screen.getByLabelText('Cron');
    await user.clear(cron);
    await user.paste('0 9 * * 1');
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
      screen.getByText('Nothing starts until a version is deployed.'),
    ).toBeVisible();
    expect(screen.getByRole('list', { name: /^Would run at/ })).toBeVisible();
    unmount();

    automation.deployedVersion = 1;
    renderGeneralTab();
    expect(screen.getByRole('list', { name: /^Next runs/ })).toBeVisible();
    expect(screen.queryByText(/deployed/)).toBeNull();
  });

  it('shows members the settings with no way to change them', () => {
    ability.canAuthor = false;
    renderGeneralTab();
    // The schedule reads as plain text, with no control to open.
    expect(screen.queryByRole('button', { name: /^Schedule:/ })).toBeNull();
    expect(screen.getAllByText('Every 6 hours')[0]).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Repeat' })).toBeDisabled();
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
