import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
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
const mockStartRun = vi.fn();
const mockToast = vi.fn();

let triggersData: TriggerView[] | undefined;
/** The deployed version's `inputs`, when it declares any. */
let deployedInputs: Record<string, unknown> | undefined;
/** The projects the automation is installed in. */
let boundProjectIds: string[] = [];
/** The runs the trigger started — a webhook's deliveries. */
let triggerRuns: unknown[] = [];

/** A stored trigger as the read returns it: every field, `overrides` on
 * top of an idle schedule. */
function row(overrides: Partial<TriggerView>): TriggerView {
  return {
    id: 'trigger-1',
    name: 'gmail-triage-inbox',
    kind: 'schedule',
    cron: null,
    repeat: null,
    startDate: null,
    timezone: null,
    catchUp: null,
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
    ...overrides,
  };
}

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

let triggersError = false;
const mockRefetch = vi.fn();

vi.mock('../hooks/queries', () => ({
  useAutomationTriggers: () => ({
    data: triggersData,
    isPending: false,
    isError: triggersError,
    refetch: mockRefetch,
  }),
  // The deployed version's document, which the trigger's input is checked
  // against.
  useDeployedAutomation: (
    _organizationId: string,
    _name: string,
    version: number | undefined,
  ) => ({
    data:
      version === undefined
        ? undefined
        : {
            document: {
              name: 'gmail-triage-inbox',
              nodes: [],
              ...(deployedInputs !== undefined && { inputs: deployedInputs }),
            },
          },
    isPending: false,
  }),
  useAutomationRun: (_organizationId: string, runId: string | undefined) => ({
    data:
      runId === undefined ? undefined : { status: 'success', stalled: false },
    isPending: false,
  }),
  useAutomationProjects: () => ({ data: boundProjectIds, isPending: false }),
  useAutomationTriggerRuns: () => ({
    data: triggerRuns,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({
    projects: [
      { _id: 'proj-1', name: 'Document desk' },
      { _id: 'proj-2', name: 'Support' },
    ],
    isLoading: false,
  }),
}));

// A new trigger reads its schedule in the reader's zone; the suite pins it.
vi.mock('@/lib/shared/zoned-time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/zoned-time')>()),
  localTimeZone: () => 'Europe/Zurich',
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
  useStartAutomationRun: () => ({
    mutateAsync: mockStartRun,
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

/** A cron a repeat rule says exactly: it opens in Repeat. */
const SCHEDULE_ROW = row({
  cron: '0 */6 * * *',
  timezone: 'UTC',
  catchUp: 'latest',
});

/** A cron no repeat rule says (7 does not divide an hour): it opens in Cron,
 * where the edit-keeping cases type. */
const CRON_ROW = row({
  cron: '*/7 * * * *',
  timezone: 'UTC',
  catchUp: 'latest',
});

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
    triggersData = [CRON_ROW];
    triggersError = false;
    deployedInputs = undefined;
    boundProjectIds = [];
    triggerRuns = [];
    mockSetTrigger.mockResolvedValue({});
    mockStartRun.mockResolvedValue({ runId: 'run-9', version: 2 });
  });

  it('shows the stored binding, with Save and Discard waiting for an edit', () => {
    renderTrigger();

    expect(screen.getByLabelText('Cron')).toHaveValue('*/7 * * * *');
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
        catchUp: 'latest',
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

    expect(cron).toHaveValue('*/7 * * * *');
    expect(saveButton()).toBeDisabled();
    expect(mockSetTrigger).not.toHaveBeenCalled();
  });

  it('keeps an edit in progress when a refetch only moves the last fire', async () => {
    const { rerender } = renderTrigger();

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 9 * * 1');
    // The trigger fired meanwhile: the row comes back as a new object.
    triggersData = [{ ...CRON_ROW, lastFiredAt: 1_790_000_000_000 }];
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
    const WEBHOOK_ROW = row({ kind: 'webhook', hasToken: true });

    function rerenderWith(
      rerender: ReturnType<typeof renderTrigger>['rerender'],
      next: TriggerView,
    ) {
      triggersData = [next];
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
      rerenderWith(rerender, { ...CRON_ROW, enabled: false });

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
          catchUp: 'latest',
          enabled: false,
        },
      });
    });

    it('keeps an edited cron when another session saved a different one', async () => {
      const { rerender } = renderTrigger();
      const cron = await editCron();
      rerenderWith(rerender, { ...CRON_ROW, cron: '*/9 * * * *' });

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
      rerenderWith(rerender, { ...CRON_ROW, enabled: false });
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

    // The fields stay editable while a save is out (#4321 review B1): a
    // change made after Save is the author's newest word, even one back to
    // the value the form loaded, whichever of the save's row and its answer
    // comes first.
    it.each([
      ['before the save answers', true],
      ['after the save answers', false],
    ])(
      'keeps a cron changed back during the save when its row lands %s',
      async (_when, rowFirst) => {
        let answer: (value: object) => void = () => {};
        mockSetTrigger.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            }),
        );
        const { rerender } = renderTrigger();
        const cron = await editCron();
        await userEvent.click(saveButton());
        await waitFor(() => expect(mockSetTrigger).toHaveBeenCalledTimes(1));
        await userEvent.clear(cron);
        await userEvent.paste('*/7 * * * *');
        const saved = { ...CRON_ROW, cron: '0 9 * * 1' };
        if (rowFirst) rerenderWith(rerender, saved);
        await act(async () => {
          answer({});
        });
        if (!rowFirst) rerenderWith(rerender, saved);

        expect(cron).toHaveValue('*/7 * * * *');
        expect(discardButton()).toBeEnabled();
        expect(savedButton()).toBeEnabled();
      },
    );

    it('settles on its own save when another session’s row lands first', async () => {
      let answer: (value: object) => void = () => {};
      mockSetTrigger.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      const { rerender } = renderTrigger();
      await editCron();
      await userEvent.click(saveButton());
      await waitFor(() => expect(mockSetTrigger).toHaveBeenCalledTimes(1));
      // Another session switches the trigger off; then this save, written
      // after it, lands with the switch on again.
      rerenderWith(rerender, { ...CRON_ROW, enabled: false });
      rerenderWith(rerender, { ...CRON_ROW, cron: '0 9 * * 1' });
      await act(async () => {
        answer({});
      });

      expect(screen.getByRole('switch', { name: 'Enabled' })).toBeChecked();
      expect(discardButton()).toBeDisabled();
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
    expect(
      screen.getByText('Fix the schedule above to see the next runs.'),
    ).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
    expect(saveButton()).toBeDisabled();
    expect(mockSetTrigger).not.toHaveBeenCalled();
  });

  // A schedule that will not fire — switched off, or on an automation with
  // no deployed version — used to promise "Next run …" all the same. The
  // next runs say what will start, what would, and when nothing can.
  describe('what the schedule will actually do', () => {
    const nextRuns = () => screen.getByRole('list', { name: /^Next runs/ });

    it('lists the next runs for an enabled schedule on a deployed automation', () => {
      renderTrigger('gmail-triage-inbox', true, 2);
      expect(nextRuns()).toBeVisible();
      expect(within(nextRuns()).getAllByRole('listitem')).toHaveLength(5);
      expect(screen.queryByText(/^Paused:/)).toBeNull();
      expect(screen.queryByText(/until a version is deployed/)).toBeNull();
    });

    it('marks the runs unsaved while the schedule differs from the stored one', async () => {
      renderTrigger('gmail-triage-inbox', true, 2);
      const cron = screen.getByLabelText('Cron');
      await userEvent.clear(cron);
      await userEvent.paste('*/9 * * * *');
      expect(
        screen.getByRole('list', { name: /^Next runs \(unsaved\)/ }),
      ).toBeVisible();
    });

    it('says the runs would start, and how, while the switch is off', async () => {
      renderTrigger('gmail-triage-inbox', true, 2);
      await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
      expect(screen.getByRole('list', { name: /^Would run at/ })).toBeVisible();
      expect(
        screen.getByText(
          'Paused: turn on Enabled and save to start these runs.',
        ),
      ).toBeVisible();
    });

    it('says nothing starts until a version is deployed, naming the would-be runs', () => {
      renderTrigger();
      expect(screen.getByRole('list', { name: /^Would run at/ })).toBeVisible();
      expect(
        screen.getByText('Nothing starts until a version is deployed.'),
      ).toBeVisible();
    });

    it('lists the server’s next run first while the form is clean', () => {
      const next = Date.now() + 60 * 60 * 1000 + 17_000;
      triggersData = [{ ...CRON_ROW, nextRunAt: next }];
      renderTrigger('gmail-triage-inbox', true, 2);
      const first = within(nextRuns()).getAllByRole('listitem')[0];
      expect(first).toHaveTextContent(
        new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'UTC',
        })
          .format(next)
          .replace(/\s/g, ' ')
          .split(' ')[0] ?? '',
      );
    });
  });

  // A stored cron a repeat rule says exactly opens as that rule, and is sent
  // back as the same cron until the schedule itself changes — a managed or
  // legacy cron never drifts on an unrelated save.
  describe('a stored cron a repeat rule can show', () => {
    beforeEach(() => {
      triggersData = [SCHEDULE_ROW];
    });

    it('opens in Repeat, says it is stored as cron, and reads clean', () => {
      renderTrigger();
      expect(screen.getByRole('radio', { name: 'Repeat' })).toBeChecked();
      expect(
        screen.getByRole('button', { name: /^Schedule: Every 6 hours/ }),
      ).toBeVisible();
      expect(
        screen.getByText(
          'Stored as the cron expression 0 */6 * * *. Saving a change to the schedule stores it as a repeat rule.',
        ),
      ).toBeVisible();
      expect(saveButton()).toBeDisabled();
    });

    it('sends the stored cron back on an unrelated save', async () => {
      renderTrigger();
      await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
      await userEvent.click(saveButton());
      expect(mockSetTrigger).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'gmail-triage-inbox',
        trigger: {
          kind: 'schedule',
          cron: '0 */6 * * *',
          timezone: 'UTC',
          catchUp: 'latest',
          enabled: false,
        },
      });
    });

    it('shows the same cron in Cron and changes nothing by flipping', async () => {
      renderTrigger();
      await userEvent.click(
        screen.getByRole('radio', { name: 'Cron (advanced)' }),
      );
      expect(screen.getByLabelText('Cron')).toHaveValue('0 */6 * * *');
      expect(screen.getByText('Reads as: Every 6 hours')).toBeVisible();
      expect(saveButton()).toBeDisabled();
      await userEvent.click(screen.getByRole('radio', { name: 'Repeat' }));
      expect(saveButton()).toBeDisabled();
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

  // A refused trigger names each problem by code; the toast says each in
  // its field's own words, never the payload.
  it('says each refused field in its own words', async () => {
    mockSetTrigger.mockRejectedValue(
      Object.assign(new Error('refused'), {
        data: {
          code: 'AUTOMATION_TRIGGER_INVALID',
          message: 'The trigger is invalid.',
          issues: [
            {
              path: 'timezone',
              code: 'timezone.unknown',
              message: '"Mars/Olympus" is not a valid IANA time zone.',
            },
            {
              path: 'input',
              code: 'input.reserved_key',
              message:
                'Remove "trigger", "event": the trigger sets these fields itself.',
            },
          ],
        },
      }),
    );
    renderTrigger();
    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.paste('0 9 * * 1');
    await userEvent.click(saveButton());

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description:
            'Pick a valid IANA time zone (e.g. Europe/Zurich or UTC). Remove trigger and event: the trigger sets these fields itself.',
        }),
      );
    });
  });

  it('shows a read that failed with Try again, and no form', async () => {
    triggersData = undefined;
    triggersError = true;
    renderTrigger();
    expect(screen.getByText("Couldn't load the trigger.")).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Add trigger' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Enabled' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
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
    // Unsaved, there is no URL yet.
    expect(
      screen.getByText('Save to mint the token; the full URL is shown once.'),
    ).toBeVisible();
    await userEvent.click(saveButton());

    // The "copy it now" alert holds the URL, whole and copyable, and the
    // test request uses it.
    const banner = (
      await screen.findByRole('heading', { name: 'Webhook URL — copy it now' })
    ).closest('[data-slot="alert"]');
    if (!(banner instanceof HTMLElement)) throw new Error('no alert');
    expect(banner).toHaveTextContent(/shown once and stored only as a hash/);
    expect(
      within(banner).getByRole('button', {
        name: /^Webhook endpoint .*\/api\/automations\/webhook\/wht_secret_1$/,
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /curl --fail-with-body --request POST ".*\/api\/automations\/webhook\/wht_secret_1"/,
      ),
    ).toBeVisible();
    // Never a placeholder project id.
    expect(screen.queryByText(/<projectId>/)).toBeNull();
  });

  // A webhook installed in projects answers on each project's door; its
  // token, once shown, stays hidden, and the deliveries it started are
  // listed with how the door recognised each.
  describe('an event trigger', () => {
    const EVENT_ROW = row({ kind: 'event', event: 'task.created' });

    it('names the projects whose events reach it, once the bindings are read [AUTO-R35]', () => {
      triggersData = [EVENT_ROW];
      boundProjectIds = ['proj-1', 'proj-2'];
      renderTrigger('gmail-triage-inbox', true, 2);
      expect(
        screen.getByText(
          'Starts for matching events in Document desk and Support, and for events that belong to no project, such as contacts.',
        ),
      ).toBeVisible();
    });

    it('says an automation of the organization hears every project [AUTO-R35]', () => {
      triggersData = [EVENT_ROW];
      renderTrigger('gmail-triage-inbox', true, 2);
      expect(
        screen.getByText(
          'Starts for matching events in every project, and for events that belong to no project.',
        ),
      ).toBeVisible();
    });
  });

  describe('a webhook installed in projects', () => {
    const WEBHOOK_ROW = row({ kind: 'webhook', hasToken: true });

    it('lists one masked URL per project, the route’s own first', () => {
      triggersData = [WEBHOOK_ROW];
      boundProjectIds = ['proj-1', 'proj-2'];
      renderTrigger('gmail-triage-inbox', true, 2, 'proj-2');
      const urls = screen.getByRole('list', { name: 'Project URLs' });
      const items = within(urls).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent(
        /^Support.*\/api\/projects\/proj-2\/automations\/webhook\/••••••••$/,
      );
      expect(items[1]).toHaveTextContent(/^Document desk/);
      expect(
        screen.getByText(
          'This automation is installed in projects, so it runs only through a project URL.',
        ),
      ).toBeVisible();
      expect(screen.getByText(/curl .*"\$TALE_WEBHOOK_URL"/)).toBeVisible();
    });

    it('lists the deliveries the webhook started', () => {
      triggersData = [WEBHOOK_ROW];
      triggerRuns = [
        {
          runId: 'run-3',
          startedAt: Date.now() - 60_000,
          status: 'success',
          deliverySource: 'header',
          header: 'idempotency-key',
        },
      ];
      renderTrigger('gmail-triage-inbox', true, 2);
      const deliveries = screen.getByRole('list', {
        name: 'Recent deliveries',
      });
      expect(deliveries).toHaveTextContent('ID from idempotency-key');
      expect(
        within(deliveries).getByRole('link', { name: 'View run' }),
      ).toHaveAttribute(
        'href',
        '/dashboard/org-1/automations/gmail-triage-inbox/runs/run-3',
      );
    });
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

    it('opens a new binding as a daily 09:00 schedule in your zone, OFF, and saves it off', async () => {
      triggersData = [];
      renderTrigger('fresh-automation');
      await userEvent.click(
        screen.getByRole('button', { name: 'Add trigger' }),
      );
      expect(screen.getByRole('switch', { name: 'Enabled' })).not.toBeChecked();
      expect(
        screen.getByRole('button', { name: /^Schedule: Daily/ }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: /^Timezone/ }),
      ).toHaveTextContent('Europe/Zurich');
      // Adding a trigger is the edit: Save waits for nothing else.
      await userEvent.click(saveButton());
      expect(mockSetTrigger).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'fresh-automation',
        trigger: {
          kind: 'schedule',
          repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
          timezone: 'Europe/Zurich',
          catchUp: 'latest',
          enabled: false,
        },
      });
    });

    it('discards a new binding back to no trigger', async () => {
      triggersData = [];
      renderTrigger('fresh-automation');
      await userEvent.click(
        screen.getByRole('button', { name: 'Add trigger' }),
      );
      await userEvent.click(discardButton());
      expect(screen.getByRole('button', { name: 'Add trigger' })).toBeVisible();
      expect(saveButton()).toBeDisabled();
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
    const WEBHOOK_ROW = row({ kind: 'webhook', hasToken: true });

    /** Switch the stored webhook to a platform event and press Save. */
    async function switchToEventAndSave() {
      await userEvent.click(
        screen.getByRole('combobox', { name: 'Trigger type' }),
      );
      await userEvent.click(
        screen.getByRole('option', { name: 'Platform event' }),
      );
      // An event trigger saves once it names its event.
      expect(saveButton()).toBeDisabled();
      await userEvent.click(
        screen.getByRole('button', { name: /^Event name/ }),
      );
      await userEvent.click(
        screen.getByRole('option', { name: /^Task created/ }),
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
        row({
          kind: 'webhook',
          hasToken: true,
          consecutiveFailures: 1,
          lastFailedAt: LAST_FAILED_AT,
          lastFailureCode: 'node_error',
          lastFailedRunId: 'run-1',
        }),
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

  // Ada's GitHub triage schedule came due, but version 3 needs owner and
  // repo, which a schedule never sends: the section says so, writes the
  // two fields into the fixed input on one click, and saves them with the
  // trigger.
  describe('what the trigger sends, and fixing it', () => {
    const GITHUB_INPUTS = {
      type: 'object',
      required: ['owner', 'repo'],
      properties: { owner: { type: 'string' }, repo: { type: 'string' } },
    };
    const DUE = Date.UTC(2026, 9, 12, 7, 0);
    const REFUSED_ROW = row({
      name: 'github-triage-issues',
      repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
      startDate: '2026-10-01',
      timezone: 'Europe/Zurich',
      catchUp: 'latest',
      lastSkippedAt: DUE + 60_000,
      lastSkipReason: 'start_refused',
      lastSkipDetail: {
        reason: 'start_refused',
        occurrence: DUE,
        code: 'AUTOMATION_INPUT_INVALID',
        version: 3,
        message: 'The run input does not match the automation inputs.',
        issues: [{ path: 'owner', message: 'Required' }],
      },
    });
    const fixedInput = () =>
      screen.getByRole('textbox', { name: 'Fixed input' });

    beforeEach(() => {
      triggersData = [REFUSED_ROW];
      deployedInputs = GITHUB_INPUTS;
    });

    it('fills the missing fields from the skip notice, focuses them, and saves them', async () => {
      const { user } = renderTrigger('github-triage-issues', true, 3);
      expect(
        screen.getByRole('heading', {
          name: "Version 3 doesn't accept this input",
        }),
      ).toBeVisible();
      const banner = screen
        .getByRole('heading', { name: "Skipped: the run's input was refused" })
        .closest('[data-slot="alert"]');
      if (!(banner instanceof HTMLElement)) throw new Error('no notice');
      await user.click(
        within(banner).getByRole('button', {
          name: 'Add the 2 missing fields',
        }),
      );
      expect(fixedInput()).toHaveValue('{\n  "owner": "",\n  "repo": ""\n}');
      await waitFor(() => expect(fixedInput()).toHaveFocus());
      await user.keyboard('acme');
      // Both fields are there now; blank text is still text.
      expect(screen.getByText('Version 3 accepts this input.')).toBeVisible();

      await user.click(saveButton());
      await waitFor(() =>
        expect(mockSetTrigger).toHaveBeenCalledWith(
          expect.objectContaining({
            trigger: expect.objectContaining({
              kind: 'schedule',
              input: { owner: 'acme', repo: '' },
            }),
          }),
        ),
      );
    });

    it('says the version accepts the input once the fixed input holds it', async () => {
      triggersData = [
        { ...REFUSED_ROW, input: { owner: 'acme', repo: 'tale' } },
      ];
      renderTrigger('github-triage-issues', true, 3);
      expect(screen.getByText('Version 3 accepts this input.')).toBeVisible();
    });

    it('takes the save’s own warning over the form’s check', async () => {
      const accepted = {
        ...REFUSED_ROW,
        input: { owner: 'acme', repo: 'tale' },
      };
      triggersData = [accepted];
      mockSetTrigger.mockResolvedValue({
        warnings: [
          {
            level: 'warning',
            code: 'TRIGGER_INPUT_MISMATCH',
            message: 'The schedule starts runs without region.',
            params: { kind: 'schedule', missing: ['region'] },
          },
        ],
      });
      const { user, rerender } = renderTrigger('github-triage-issues', true, 3);
      expect(screen.getByText('Version 3 accepts this input.')).toBeVisible();
      await user.click(screen.getByRole('switch', { name: 'Enabled' }));
      await user.click(saveButton());
      await waitFor(() => expect(mockSetTrigger).toHaveBeenCalledTimes(1));
      // The store holds what was sent; the form reads clean again.
      triggersData = [{ ...accepted, enabled: false }];
      rerender(
        <GeneralTab>
          <TriggerEditor
            organizationId="org-1"
            name="github-triage-issues"
            canEdit
            deployedVersion={3}
          />
        </GeneralTab>,
      );
      expect(
        await screen.findByRole('heading', {
          name: "Version 3 doesn't accept this input",
        }),
      ).toBeVisible();
      expect(screen.getByText('region')).toBeVisible();
    });

    it('sends the reader to the Projects field when a project refused the start', async () => {
      triggersData = [
        {
          ...REFUSED_ROW,
          lastSkipDetail: {
            reason: 'start_refused',
            occurrence: DUE,
            code: 'PROJECT_ARCHIVED',
            version: null,
            message: 'The project is archived.',
          },
        },
      ];
      const { user } = render(
        <GeneralTab>
          <TriggerEditor
            organizationId="org-1"
            name="github-triage-issues"
            canEdit
            deployedVersion={3}
          />
          <label htmlFor="automation-projects-field">Projects</label>
          <input id="automation-projects-field" />
        </GeneralTab>,
      );
      await user.click(
        screen.getByRole('button', { name: 'Edit the projects' }),
      );
      expect(screen.getByRole('textbox', { name: 'Projects' })).toHaveFocus();
    });

    it('hands focus to the schedule when it could not be read', async () => {
      triggersData = [
        {
          ...REFUSED_ROW,
          lastSkipReason: 'unusable_cron',
          lastSkipDetail: { reason: 'unusable_cron', message: 'Bad zone.' },
        },
      ];
      const { user } = renderTrigger('github-triage-issues', true, 3);
      await user.click(
        screen.getByRole('button', { name: 'Edit the schedule' }),
      );
      expect(
        screen.getByRole('button', { name: /^Schedule: Daily/ }),
      ).toHaveFocus();
    });

    // Run now acts where the trigger acts: the store infers the sole
    // installation, so no project is named even from a project's tab.
    it('runs the stored trigger now, naming the project it acts in', async () => {
      boundProjectIds = ['proj-1'];
      triggersData = [
        { ...REFUSED_ROW, input: { owner: 'acme', repo: 'tale' } },
      ];
      const { user } = renderTrigger('github-triage-issues', true, 3, 'proj-1');
      await user.click(screen.getByRole('button', { name: 'Run now' }));
      const dialog = screen.getByRole('dialog', { name: 'Run live?' });
      expect(dialog).toHaveTextContent(/in the Document desk project/);
      await user.click(
        within(dialog).getByRole('button', { name: 'Start run' }),
      );
      await waitFor(() =>
        expect(mockStartRun).toHaveBeenCalledWith({
          organizationId: 'org-1',
          name: 'github-triage-issues',
          mode: 'live',
          version: 3,
          input: {
            owner: 'acme',
            repo: 'tale',
            trigger: 'schedule',
            firedAt: expect.any(Number),
          },
        }),
      );
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Run started.',
      );
    });

    it('holds Run now while the trigger has unsaved edits', async () => {
      const { user } = renderTrigger('github-triage-issues', true, 3);
      await user.click(screen.getByRole('switch', { name: 'Enabled' }));
      expect(screen.getByRole('button', { name: 'Run now' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('offers members no Run now and no empty fixed input', () => {
      renderTrigger('github-triage-issues', false, 3);
      expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
      expect(screen.queryByText('Add fixed input')).toBeNull();
      expect(
        screen.getByRole('region', { name: 'This run receives' }),
      ).toBeVisible();
    });
  });
});
