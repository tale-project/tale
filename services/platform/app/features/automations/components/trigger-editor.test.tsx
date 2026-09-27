import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { AutomationEditorActions } from './automation-editor-actions';
import { TriggerEditor } from './trigger-editor';

const mockSetTrigger = vi.fn();
const mockDeleteTrigger = vi.fn();
const mockToast = vi.fn();

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
  useAutomationTriggers: () => ({ data: triggersData, isPending: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useSetAutomationTrigger: () => ({
    mutateAsync: mockSetTrigger,
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

// The page cluster owns the one failure toast a refused save raises.
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: (...args: unknown[]) => mockToast(...args),
}));

const SCHEDULE_ROW = {
  name: 'gmail-triage-inbox',
  kind: 'schedule',
  cron: '0 */6 * * *',
  timezone: 'UTC',
  hasToken: false,
  enabled: true,
};

/** The General tab's frame: its sections join one Save/Discard cluster. */
function GeneralTab({ children }: { children: ReactNode }) {
  return (
    <ActiveEditorProvider>
      <AutomationEditorActions />
      <EditorGroup>{children}</EditorGroup>
    </ActiveEditorProvider>
  );
}

function renderTrigger(
  name = 'gmail-triage-inbox',
  canEdit = true,
  deployedVersion?: number,
) {
  return render(
    <GeneralTab>
      <TriggerEditor
        organizationId="org-1"
        name={name}
        canEdit={canEdit}
        deployedVersion={deployedVersion}
      />
    </GeneralTab>,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });

describe('TriggerEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggersData = [SCHEDULE_ROW];
    mockSetTrigger.mockResolvedValue({});
  });

  it('shows the stored binding, with Save and Discard waiting for an edit', () => {
    renderTrigger();

    expect(screen.getByLabelText('Cron')).toHaveValue('0 */6 * * *');
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
  });

  it("saves an edited schedule binding from the page's cluster", async () => {
    renderTrigger();

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 9 * * 1');
    await userEvent.click(saveButton());

    expect(mockSetTrigger).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'gmail-triage-inbox',
      trigger: {
        kind: 'schedule',
        cron: '0 9 * * 1',
        timezone: 'UTC',
        enabled: true,
      },
    });
  });

  it('discards an edit back to the stored binding', async () => {
    renderTrigger();

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 9 * * 1');
    await userEvent.click(discardButton());

    expect(cron).toHaveValue('0 */6 * * *');
    expect(saveButton()).toBeDisabled();
    expect(mockSetTrigger).not.toHaveBeenCalled();
  });

  it('keeps an edit in progress when a refetch only moves the last fire', async () => {
    const { rerender } = renderTrigger();

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 9 * * 1');
    // The trigger fired meanwhile: the row comes back as a new object.
    triggersData = [{ ...SCHEDULE_ROW, lastFiredAt: 1_790_000_000_000 }];
    rerender(
      <GeneralTab>
        <TriggerEditor
          organizationId="org-1"
          name="gmail-triage-inbox"
          canEdit
        />
      </GeneralTab>,
    );

    expect(cron).toHaveValue('0 9 * * 1');
    expect(saveButton()).toBeEnabled();
  });

  it('holds Save while the cron cannot be read', async () => {
    renderTrigger();

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, 'every morning');

    expect(
      screen.getByText(/That cron expression is not valid/),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  // A four-field cron used to preview a "next run" and then fail to save:
  // the section now judges with the bind's own parser and shows its sentence.
  it('refuses a four-field cron with the validator’s sentence and no next run', async () => {
    renderTrigger();
    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '*/1 * * *');
    expect(
      screen.getByText(/That cron expression is not valid: .*got 4/),
    ).toBeVisible();
    expect(screen.queryByText(/Next run/)).toBeNull();
    expect(saveButton()).toBeDisabled();
    expect(mockSetTrigger).not.toHaveBeenCalled();
  });

  // A schedule that will not fire — switched off, or on an automation with
  // no deployed version — used to promise "Next run …" all the same.
  describe('what the schedule will actually do', () => {
    it('promises the next run only for an enabled schedule on a deployed automation', () => {
      renderTrigger('gmail-triage-inbox', true, 2);
      expect(screen.getByText(/Every 6 hours · Next run/)).toBeVisible();
      expect(screen.queryByText(/Paused/)).toBeNull();
      expect(screen.queryByText(/deployed/)).toBeNull();
    });

    it('reads paused, with no next run, while the switch is off', async () => {
      renderTrigger('gmail-triage-inbox', true, 2);
      await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
      expect(
        screen.getByText('Every 6 hours · Paused — no runs start'),
      ).toBeVisible();
      expect(screen.queryByText(/Next run/)).toBeNull();
    });

    it('says the schedule will not start until a version is deployed, naming the would-be run', () => {
      renderTrigger();
      expect(
        screen.getByText(
          /Every 6 hours · Won't start until a version is deployed · would next run /,
        ),
      ).toBeVisible();
      expect(screen.queryByText(/^Next run/)).toBeNull();
    });
  });

  it("raises a refused save as the cluster's one toast, keeping the edit", async () => {
    mockSetTrigger.mockRejectedValue(new Error('Trigger store is offline.'));
    renderTrigger();

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 9 * * 1');
    await userEvent.click(saveButton());

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: 'Trigger store is offline.',
        }),
      );
    });
    expect(cron).toHaveValue('0 9 * * 1');
    expect(saveButton()).toBeEnabled();
  });

  it('shows a minted webhook token exactly where the save reported it', async () => {
    triggersData = [];
    mockSetTrigger.mockResolvedValue({ token: 'wht_secret_1' });
    renderTrigger('fresh-automation');

    await userEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Trigger type' }),
    );
    await userEvent.click(screen.getByRole('option', { name: 'Webhook' }));
    await userEvent.click(saveButton());

    // The minted token appears inside the ready-to-run curl command (the
    // "copy it now" alert and the persistent endpoint block both show it).
    expect(
      (
        await screen.findAllByText(
          /curl -X POST .*\/api\/automations\/webhook\/wht_secret_1/,
        )
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
  // from a half-filled armed one — and a cron typed into it saved armed.
  describe('without a stored trigger', () => {
    it('says so, with an Add trigger affordance and no armed-looking form', () => {
      triggersData = [];
      renderTrigger('fresh-automation');
      expect(
        screen.getByText(/No trigger — this automation runs only when/),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add trigger' })).toBeVisible();
      expect(screen.queryByRole('switch', { name: 'Enabled' })).toBeNull();
      expect(screen.queryByLabelText('Cron')).toBeNull();
      expect(saveButton()).toBeDisabled();
    });

    it('opens a new binding with Enabled OFF and saves it off', async () => {
      triggersData = [];
      renderTrigger('fresh-automation');
      await userEvent.click(
        screen.getByRole('button', { name: 'Add trigger' }),
      );
      expect(screen.getByRole('switch', { name: 'Enabled' })).not.toBeChecked();
      await userEvent.type(screen.getByLabelText('Cron'), '0 9 * * 1');
      await userEvent.click(saveButton());
      expect(mockSetTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: expect.objectContaining({
            kind: 'schedule',
            enabled: false,
          }),
        }),
      );
    });

    it('keeps the plain sentence for members', () => {
      triggersData = [];
      renderTrigger('fresh-automation', false);
      expect(screen.getByText(/No trigger/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Add trigger' })).toBeNull();
    });
  });

  // Replacing a live webhook with another kind, and rotating its token,
  // both revoke the URL a sending system holds — neither happens on one
  // click, and a revocation the server reports is said out loud.
  describe('irreversible webhook moves', () => {
    const WEBHOOK_ROW = {
      name: 'gmail-triage-inbox',
      kind: 'webhook',
      hasToken: true,
      enabled: true,
    };

    /** Switch the stored webhook to a platform event and press Save. */
    async function switchToEventAndSave() {
      await userEvent.click(
        screen.getByRole('combobox', { name: 'Trigger type' }),
      );
      await userEvent.click(
        screen.getByRole('option', { name: 'Platform event' }),
      );
      await userEvent.click(saveButton());
    }

    it('asks before switching a live webhook to another kind, then reports the revocation', async () => {
      triggersData = [WEBHOOK_ROW];
      mockSetTrigger.mockResolvedValue({ revoked: 'webhook' });
      renderTrigger();
      await switchToEventAndSave();
      expect(mockSetTrigger).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog', {
        name: 'Replace the webhook?',
      });
      expect(dialog).toHaveTextContent(/revokes the webhook URL immediately/);
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Replace and revoke' }),
      );
      await waitFor(() => {
        expect(mockSetTrigger).toHaveBeenCalledWith(
          expect.objectContaining({
            trigger: expect.objectContaining({ kind: 'event' }),
          }),
        );
      });
      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringMatching(
              /previous webhook URL has been revoked/,
            ),
          }),
        );
      });
    });

    it('backs out of the revocation without saving or a failure toast, keeping the edit', async () => {
      triggersData = [WEBHOOK_ROW];
      renderTrigger();
      await switchToEventAndSave();
      const dialog = screen.getByRole('dialog', {
        name: 'Replace the webhook?',
      });
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(mockSetTrigger).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
      // The draft is still there to save once the author is sure.
      expect(saveButton()).toBeEnabled();
    });

    it('saves a schedule edit without asking — nothing is revoked', async () => {
      renderTrigger();
      const cron = screen.getByLabelText('Cron');
      await userEvent.clear(cron);
      await userEvent.type(cron, '0 9 * * 1');
      await userEvent.click(saveButton());
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => {
        expect(mockSetTrigger).toHaveBeenCalledTimes(1);
      });
    });

    it('rotates the token only through the confirm dialog', async () => {
      triggersData = [WEBHOOK_ROW];
      renderTrigger();
      await userEvent.click(
        screen.getByRole('button', { name: 'Rotate token' }),
      );
      expect(mockSetTrigger).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog', {
        name: 'Rotate the webhook token?',
      });
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Rotate token' }),
      );
      expect(mockSetTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ rotateToken: true }),
      );
    });
  });

  it('renders read-only for members: binding visible, no controls', () => {
    renderTrigger('gmail-triage-inbox', false);

    expect(screen.getByLabelText('Cron')).toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove trigger' }),
    ).not.toBeInTheDocument();
  });

  it('removes the binding only through the confirm dialog', async () => {
    renderTrigger();

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

  it('closes the removal dialog after a deletion and returns to no trigger', async () => {
    mockDeleteTrigger.mockImplementation(
      (_args: unknown, options: { onSuccess: () => void }) => {
        // The binding is gone once the store answers.
        triggersData = [];
        options.onSuccess();
      },
    );
    renderTrigger();

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove trigger' }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove trigger' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockDeleteTrigger).toHaveBeenCalledTimes(1);
    // Back to "no trigger", and the removed binding is not left behind as an
    // unsaved edit.
    expect(screen.getByText(/No trigger/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add trigger' })).toBeVisible();
    expect(screen.queryByLabelText('Cron')).toBeNull();
    expect(saveButton()).toBeDisabled();
  });
});
