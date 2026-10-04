import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

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
      lastSkipReason?: string | null;
      consecutiveFailures?: number;
      lastFailedAt?: number | null;
      lastFailureCode?: string | null;
      lastFailedRunId?: string | null;
    }>
  | undefined;

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
}

// The failure notice links the last failed run; outside a router the link
// renders as the path it would open. React is imported inside the factory:
// the mock is hoisted above the file's imports, and `@tale/ui` reaches the
// router before a top-level React binding exists.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { createElement, forwardRef } = await import('react');
  return {
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
      { to, params, children, ...rest },
      ref,
    ) {
      const path = Object.entries(params ?? {}).reduce(
        (acc, [key, value]) => acc.replace(`$${key}`, value),
        to ?? '',
      );
      return createElement('a', { ref, href: path, ...rest }, children);
    }),
  };
});

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

/** The design system's `InlineCode` (`@tale/ui`): a `<code>` chip in its
 * mono face — which the hand-rolled `<code>` it replaced never set. */
function expectInlineCode(element: HTMLElement) {
  expect(element.tagName).toBe('CODE');
  expect(element).toHaveClass('bg-muted', 'font-mono', 'text-xs');
}

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
  projectId?: string,
) {
  return render(
    <GeneralTab>
      <TriggerEditor
        organizationId="org-1"
        name={name}
        canEdit={canEdit}
        deployedVersion={deployedVersion}
        projectId={projectId}
      />
    </GeneralTab>,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });
/** Save, which reads "Saved" for a moment after a save went through. */
const savedButton = () => screen.getByRole('button', { name: /^Saved?$/ });

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

  // A row another session saved reaches a form holding an edit (#3620): the
  // fields the author changed keep the edit, the ones they left alone follow
  // the row — and a save's own row still settles the form.
  describe('a row saved while the form holds an edit', () => {
    const WEBHOOK_ROW = {
      name: 'gmail-triage-inbox',
      kind: 'webhook',
      hasToken: true,
      enabled: true,
    };

    function rerenderWith(
      rerender: ReturnType<typeof renderTrigger>['rerender'],
      row: NonNullable<typeof triggersData>[number],
    ) {
      triggersData = [row];
      rerender(
        <GeneralTab>
          <TriggerEditor
            organizationId="org-1"
            name="gmail-triage-inbox"
            canEdit
          />
        </GeneralTab>,
      );
    }

    async function editCron() {
      const cron = screen.getByLabelText('Cron');
      await userEvent.clear(cron);
      await userEvent.paste('0 9 * * 1');
      return cron;
    }

    /** Edit the cron, make the binding a webhook, and press Save. */
    async function saveCronEditAsWebhook() {
      await editCron();
      await userEvent.click(
        screen.getByRole('combobox', { name: 'Trigger type' }),
      );
      await userEvent.click(screen.getByRole('option', { name: 'Webhook' }));
      await userEvent.click(saveButton());
      await waitFor(() => expect(mockSetTrigger).toHaveBeenCalledTimes(1));
    }

    it('keeps an edited cron when another session switches the trigger off', async () => {
      const { rerender } = renderTrigger();
      const cron = await editCron();
      rerenderWith(rerender, { ...SCHEDULE_ROW, enabled: false });

      expect(cron).toHaveValue('0 9 * * 1');
      // The switch the author left alone takes the other session's answer.
      expect(screen.getByRole('switch', { name: 'Enabled' })).not.toBeChecked();
      expect(saveButton()).toBeEnabled();

      await userEvent.click(saveButton());
      expect(mockSetTrigger).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'gmail-triage-inbox',
        trigger: {
          kind: 'schedule',
          cron: '0 9 * * 1',
          timezone: 'UTC',
          enabled: false,
        },
      });
    });

    it('keeps an edited cron when another session saved a different one', async () => {
      const { rerender } = renderTrigger();
      const cron = await editCron();
      rerenderWith(rerender, { ...SCHEDULE_ROW, cron: '0 7 * * *' });

      expect(cron).toHaveValue('0 9 * * 1');
      expect(saveButton()).toBeEnabled();
    });

    it('keeps the edit when the save is refused while another session’s row arrives', async () => {
      let refuse: (error: Error) => void = () => {};
      mockSetTrigger.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
      );
      const { rerender } = renderTrigger();
      const cron = await editCron();
      await userEvent.click(saveButton());
      await waitFor(() => expect(mockSetTrigger).toHaveBeenCalledTimes(1));
      rerenderWith(rerender, { ...SCHEDULE_ROW, enabled: false });
      await act(async () => {
        refuse(new Error('The store refused the trigger.'));
      });

      expect(cron).toHaveValue('0 9 * * 1');
      expect(screen.getByRole('switch', { name: 'Enabled' })).not.toBeChecked();
      expect(saveButton()).toBeEnabled();
    });

    it('settles on the row its own save wrote, cron left behind', async () => {
      const { rerender } = renderTrigger();
      await saveCronEditAsWebhook();
      // The store holds the webhook now, with no cron.
      rerenderWith(rerender, WEBHOOK_ROW);

      // Nothing is left to save: the cluster reads clean, not dirty.
      expect(discardButton()).toBeDisabled();
      expect(savedButton()).toBeDisabled();
    });

    it('settles on its own save when the row lands before the save answers', async () => {
      let answer: (value: object) => void = () => {};
      mockSetTrigger.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      const { rerender } = renderTrigger();
      await saveCronEditAsWebhook();
      rerenderWith(rerender, WEBHOOK_ROW);
      await act(async () => {
        answer({});
      });

      expect(discardButton()).toBeDisabled();
      expect(savedButton()).toBeDisabled();
    });
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
    const commands = await screen.findAllByText(
      /curl -X POST .*\/api\/automations\/webhook\/wht_secret_1/,
    );
    expect(commands).toHaveLength(2);
    expect(
      screen.getByText(/shown once and stored only as a hash/),
    ).toBeInTheDocument();
    const projectCommand = screen.getByText(
      /\/api\/projects\/<projectId>\/automations\/webhook\/wht_secret_1/,
    );
    expect(screen.queryByText(/\?projectId=/)).not.toBeInTheDocument();
    // Each command is the design system's inline code, whole and wrapping,
    // selected in one click.
    for (const command of [...commands, projectCommand]) {
      expectInlineCode(command);
      expect(command).toHaveClass('break-all', 'select-all');
    }
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
  // A schedule that kept failing for a reason a retry won't fix turns itself
  // off (`trigger-failures.ts`); the section says so, names the last failure
  // and opens its run — and counts a streak before it gets there.
  describe('the failure streak', () => {
    const LAST_FAILED_AT = Date.UTC(2026, 8, 27, 9, 0);

    it('shows a schedule its failures paused, with the last failure and its run', () => {
      triggersData = [
        {
          ...SCHEDULE_ROW,
          name: 'ops/nightly',
          enabled: false,
          lastSkipReason: 'paused_after_failures',
          consecutiveFailures: 5,
          lastFailedAt: LAST_FAILED_AT,
          lastFailureCode: 'connector_error',
          lastFailedRunId: 'run-5',
        },
      ];
      renderTrigger('ops/nightly');

      expect(screen.getByText('Paused after repeated failures')).toBeVisible();
      expect(
        screen.getByText(
          "5 runs in a row failed with an error a retry won't fix, so the schedule turned itself off. Fix the automation, then turn the trigger back on and save.",
        ),
      ).toBeVisible();
      expect(screen.getByText('connector_error')).toBeVisible();
      expect(screen.getByRole('link', { name: 'View run' })).toHaveAttribute(
        'href',
        '/dashboard/org-1/automations/ops__nightly/runs/run-5',
      );
      // A standing state, not news: no live region on every visit.
      expect(screen.queryByRole('alert')).toBeNull();
      // The design system's warning `Alert`, static (`live="off"`), its
      // title a heading, with the code as `InlineCode` inside it.
      const banner = screen
        .getByRole('heading', { name: 'Paused after repeated failures' })
        .closest('[data-slot="alert"]');
      expect(banner).toHaveAttribute('data-variant', 'warning');
      expect(banner).toHaveAttribute('aria-live', 'off');
      expect(banner).not.toHaveAttribute('role');
      const code = screen.getByText('connector_error');
      expectInlineCode(code);
      expect(banner).toContainElement(code);
      expect(banner).toContainElement(
        screen.getByRole('link', { name: 'View run' }),
      );
    });

    it('opens the last failed run under the project the tab is shown in', () => {
      triggersData = [
        {
          ...SCHEDULE_ROW,
          name: 'ops/nightly',
          enabled: false,
          lastSkipReason: 'paused_after_failures',
          consecutiveFailures: 5,
          lastFailedAt: LAST_FAILED_AT,
          lastFailureCode: 'connector_error',
          lastFailedRunId: 'run-5',
        },
      ];
      renderTrigger('ops/nightly', true, undefined, 'proj-1');

      expect(screen.getByRole('link', { name: 'View run' })).toHaveAttribute(
        'href',
        '/dashboard/org-1/projects/proj-1/automations/ops__nightly/runs/run-5',
      );
    });

    it('counts failing runs on a live schedule before it pauses', () => {
      triggersData = [
        {
          ...SCHEDULE_ROW,
          consecutiveFailures: 2,
          lastFailedAt: LAST_FAILED_AT,
          lastFailureCode: 'auth_error',
          lastFailedRunId: 'run-2',
        },
      ];
      renderTrigger();

      expect(
        screen.getByText(
          "The last 2 runs failed with an error a retry won't fix. After 5 in a row, the schedule turns itself off.",
        ),
      ).toBeVisible();
      expect(screen.getByText('auth_error')).toBeVisible();
      expectInlineCode(screen.getByText('auth_error'));
      expect(screen.queryByText('Paused after repeated failures')).toBeNull();
      // A line under the section, not a banner.
      expect(screen.getByText('auth_error').closest('[aria-live]')).toBeNull();
    });

    it('counts a webhook streak without promising a pause', () => {
      triggersData = [
        {
          name: 'gmail-triage-inbox',
          kind: 'webhook',
          hasToken: true,
          enabled: true,
          consecutiveFailures: 1,
          lastFailedAt: LAST_FAILED_AT,
          lastFailureCode: 'node_error',
          lastFailedRunId: 'run-1',
        },
      ];
      renderTrigger();

      expect(
        screen.getByText(
          "The last run failed with an error a retry won't fix.",
        ),
      ).toBeVisible();
      expect(screen.queryByText(/turns itself off/)).toBeNull();
    });

    it('says nothing while the streak is empty', () => {
      triggersData = [
        {
          ...SCHEDULE_ROW,
          consecutiveFailures: 0,
          lastFailedAt: LAST_FAILED_AT,
          lastFailureCode: 'node_error',
          lastFailedRunId: 'run-1',
        },
      ];
      renderTrigger();

      expect(screen.queryByText(/a retry won't fix/)).toBeNull();
      expect(screen.queryByRole('link', { name: 'View run' })).toBeNull();
    });
  });
});
