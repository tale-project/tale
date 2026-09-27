import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { TriggerEditor } from './trigger-editor';

const mockSetTrigger = vi.fn();
const mockDeleteTrigger = vi.fn();

let triggersData:
  | Array<{
      name: string;
      kind: string;
      cron?: string;
      timezone?: string;
      event?: string;
      hasToken: boolean;
      enabled: boolean;
      lastFiredAt?: number;
    }>
  | undefined;

vi.mock('../hooks/queries', () => ({
  useAutomationTriggers: () => ({ data: triggersData }),
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
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const SCHEDULE_ROW = {
  name: 'gmail-triage-inbox',
  kind: 'schedule',
  cron: '0 */6 * * *',
  timezone: 'UTC',
  hasToken: false,
  enabled: true,
};

describe('TriggerEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggersData = [SCHEDULE_ROW];
  });

  it('closes the removal dialog only after a successful deletion', async () => {
    mockDeleteTrigger.mockImplementation(
      (_args: unknown, options: { onSuccess: () => void }) =>
        options.onSuccess(),
    );
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit
      />,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove trigger' }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove trigger' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockDeleteTrigger).toHaveBeenCalledTimes(1);
  });

  it('shows the stored binding and refuses a no-op save', () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit
      />,
    );

    expect(screen.getByLabelText('Cron')).toHaveValue('0 */6 * * *');
    // `disabledReason` keeps the button focusable, so it disables via ARIA.
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('saves an edited schedule binding', async () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit
      />,
    );

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 9 * * 1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockSetTrigger).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'gmail-triage-inbox',
        trigger: {
          kind: 'schedule',
          cron: '0 9 * * 1',
          timezone: 'UTC',
          enabled: true,
        },
      },
      expect.anything(),
    );
  });

  // A four-field cron used to preview a "next run" and then fail to save
  // (2026-09-26 evaluation, D-05): the panel now judges with the bind's own
  // parser and shows its sentence.
  it('refuses a four-field cron with the validator’s sentence and no next run', async () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit
      />,
    );
    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '*/1 * * *');
    expect(
      screen.getByText(/That cron expression is not valid: .*got 4/),
    ).toBeVisible();
    expect(screen.queryByText(/Next run/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(mockSetTrigger).not.toHaveBeenCalled();
  });

  // A schedule that will not fire — switched off, or on an automation with
  // no deployed version — used to promise "Next run …" all the same
  // (2026-09-26 evaluation, D-06).
  describe('what the schedule will actually do', () => {
    it('promises the next run only for an enabled schedule on a deployed automation', () => {
      render(
        <TriggerEditor
          organizationId="org-1"
          name="gmail-triage-inbox"
          canEdit
          deployedVersion={2}
        />,
      );
      expect(screen.getByText(/Every 6 hours · Next run/)).toBeVisible();
      expect(screen.queryByText(/Paused/)).toBeNull();
      expect(screen.queryByText(/deployed/)).toBeNull();
    });

    it('reads paused, with no next run, while the switch is off', async () => {
      render(
        <TriggerEditor
          organizationId="org-1"
          name="gmail-triage-inbox"
          canEdit
          deployedVersion={2}
        />,
      );
      await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
      expect(
        screen.getByText('Every 6 hours · Paused — no runs start'),
      ).toBeVisible();
      expect(screen.queryByText(/Next run/)).toBeNull();
    });

    it('says the schedule will not start until a version is deployed, naming the would-be run', () => {
      render(
        <TriggerEditor
          organizationId="org-1"
          name="gmail-triage-inbox"
          canEdit
        />,
      );
      expect(
        screen.getByText(
          /Every 6 hours · Won't start until a version is deployed · would next run /,
        ),
      ).toBeVisible();
      expect(screen.queryByText(/^Next run/)).toBeNull();
    });
  });

  it('shows a minted webhook token exactly where the save reported it', async () => {
    triggersData = [];
    mockSetTrigger.mockImplementation(
      (
        _args: unknown,
        options?: { onSuccess?: (result: { token?: string }) => void },
      ) => {
        options?.onSuccess?.({ token: 'wht_secret_1' });
      },
    );
    render(
      <TriggerEditor organizationId="org-1" name="fresh-automation" canEdit />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Trigger type' }),
    );
    await userEvent.click(screen.getByRole('option', { name: 'Webhook' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The minted token appears inside the ready-to-run curl command (the
    // "copy it now" alert and the persistent endpoint block both show it).
    expect(
      screen.getAllByText(
        /curl -X POST .*\/api\/automations\/webhook\/wht_secret_1/,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/shown once and stored only as a hash/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /\/api\/projects\/<projectId>\/automations\/webhook\/wht_secret_1/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\?projectId=/)).not.toBeInTheDocument();
  });

  // No binding used to draw an ENABLED, empty schedule — indistinguishable
  // from a half-filled armed one — and a cron typed into it saved armed
  // (2026-09-26 evaluation, D-10).
  describe('without a stored trigger', () => {
    it('says so, with an Add trigger affordance and no armed-looking form', () => {
      triggersData = [];
      render(
        <TriggerEditor
          organizationId="org-1"
          name="fresh-automation"
          canEdit
        />,
      );
      expect(
        screen.getByText(/No trigger — this automation runs only when/),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add trigger' })).toBeVisible();
      expect(screen.queryByRole('switch', { name: 'Enabled' })).toBeNull();
      expect(screen.queryByLabelText('Cron')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('opens a new binding with Enabled OFF and saves it off', async () => {
      triggersData = [];
      render(
        <TriggerEditor
          organizationId="org-1"
          name="fresh-automation"
          canEdit
        />,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Add trigger' }),
      );
      expect(screen.getByRole('switch', { name: 'Enabled' })).not.toBeChecked();
      await userEvent.type(screen.getByLabelText('Cron'), '0 9 * * 1');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(mockSetTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: expect.objectContaining({
            kind: 'schedule',
            enabled: false,
          }),
        }),
        expect.anything(),
      );
    });

    it('keeps the plain sentence for members', () => {
      triggersData = [];
      render(
        <TriggerEditor
          organizationId="org-1"
          name="fresh-automation"
          canEdit={false}
        />,
      );
      expect(screen.getByText(/No trigger/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Add trigger' })).toBeNull();
    });
  });

  it('renders read-only for members: binding visible, no controls', () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit={false}
      />,
    );

    expect(screen.getByLabelText('Cron')).toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove trigger' }),
    ).not.toBeInTheDocument();
  });

  it('removes the binding only through the confirm dialog', async () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove trigger' }),
    );
    expect(mockDeleteTrigger).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', {
      name: 'Remove the trigger?',
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove trigger' }),
    );
    expect(mockDeleteTrigger).toHaveBeenCalledWith(
      { organizationId: 'org-1', name: 'gmail-triage-inbox' },
      expect.anything(),
    );
  });
});
