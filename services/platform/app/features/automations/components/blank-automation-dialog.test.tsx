import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isValidAutomationName } from '@/lib/engine/core/validate/name';
import { render, screen, within } from '@/tests/utils/render';

import { BlankAutomationDialog } from './blank-automation-dialog';

// The picker's roster: the SAME model served by a direct OpenRouter key and
// an Anthropic subscription (lookalike ids), plus a subscription entry bound
// to another harness. The wizard used to collapse options by id and store a
// bare model string — the saved node then resolved to whichever provider the
// walk reached first, never the one picked on screen.
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectHarnesses: () => ({
    data: {
      harnesses: [{ harness: 'claude-code', label: 'Claude Code' }],
      models: [
        {
          id: 'anthropic/claude-fable-5',
          label: 'anthropic/claude-fable-5',
          providerSlug: 'openrouter',
          providerLabel: 'OpenRouter',
          credential: { authMethod: 'api-key' },
        },
        {
          id: 'claude-fable-5',
          label: 'claude-fable-5',
          providerSlug: 'anthropic',
          providerLabel: 'Anthropic',
          credential: {
            authMethod: 'subscription-broker',
            constraints: { harness: 'claude-code' },
          },
        },
        {
          id: 'gpt-6-codex',
          label: 'gpt-6-codex',
          providerSlug: 'openai',
          providerLabel: 'OpenAI',
          credential: {
            authMethod: 'subscription-key',
            constraints: { harness: 'codex' },
          },
        },
      ],
    },
    isError: false,
  }),
  useAgentSecrets: () => ({ data: [] }),
  useProjects: () => ({
    projects: [{ _id: 'proj-7', name: 'Billing' }],
    isLoading: false,
  }),
}));

vi.mock('../hooks/queries', () => ({
  useAutomationCapabilities: () => ({
    data: { skills: [], connectors: [] },
  }),
}));

// The secrets manager talks to backend actions on mount; the model pin story
// never touches it.
vi.mock('@/app/features/projects/components/agent-secrets-field', () => ({
  AgentSecretsField: () => null,
}));

const { saveAutomation, setTrigger, navigate } = vi.hoisted(() => ({
  saveAutomation: vi.fn().mockResolvedValue({ name: 'triage' }),
  setTrigger: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useSaveAutomation: () => ({ mutateAsync: saveAutomation }),
  useSetAutomationTrigger: () => ({ mutateAsync: setTrigger }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: 'org-1' }),
}));

// A new trigger reads its schedule in the author's zone; the suite pins it.
vi.mock('@/lib/shared/zoned-time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/zoned-time')>()),
  localTimeZone: () => 'Europe/Zurich',
}));

beforeEach(() => {
  saveAutomation.mockClear();
  setTrigger.mockClear();
  navigate.mockClear();
});

function renderDialog() {
  return render(
    <BlankAutomationDialog
      organizationId="org-1"
      open
      onOpenChange={vi.fn()}
    />,
  );
}

/** Fill step 1 and move to the trigger step. */
async function reachTriggerStep(user: ReturnType<typeof renderDialog>['user']) {
  await user.type(screen.getByLabelText(/Name/i), 'Triage');
  await user.click(screen.getByRole('button', { name: /Agent model/i }));
  await user.click(screen.getByRole('option', { name: /^claude-fable-5/ }));
  await user.type(screen.getByLabelText(/What should it do\?/i), 'Scan issues');
  await user.click(screen.getByRole('button', { name: /Next/i }));
}

/**
 * The wizard's trigger step is the General tab's trigger form: it starts
 * from a daily 09:00 schedule in the author's zone, and judges the draft
 * with the bind's own checks before it writes anything — so an invalid
 * cron never half-creates an automation whose trigger then fails to set
 * (2026-09-26 evaluation, D-02).
 */
// The trigger step renders the whole trigger form and its next runs; under
// a full parallel run its first render can take longer than the default.
describe(
  'BlankAutomationDialog schedule validation',
  { timeout: 30_000 },
  () => {
    it('starts from a daily 09:00 schedule in your zone and lists its next runs', async () => {
      const { user } = renderDialog();
      await reachTriggerStep(user);
      expect(screen.getByRole('radio', { name: /^Schedule/ })).toBeChecked();
      expect(
        screen.getByRole('button', { name: /^Schedule: Daily/ }),
      ).toBeVisible();
      // The searchable picker renders its trigger as a button, like the model
      // picker on step 1 — free text is gone.
      expect(
        screen.getByRole('button', { name: /Timezone/i }),
      ).toHaveTextContent('Europe/Zurich');
      expect(screen.queryByRole('textbox', { name: /Timezone/i })).toBeNull();
      // Nothing is deployed yet, so the runs would start, not will.
      const runs = screen.getByRole('list', { name: /^Would run at/ });
      expect(within(runs).getAllByRole('listitem')).toHaveLength(3);
      // The wizard keeps to the essentials: Missed runs waits on the tab.
      expect(
        screen.queryByRole('combobox', { name: 'Missed runs' }),
      ).toBeNull();
      expect(
        screen.getByRole('button', { name: /Create automation/i }),
      ).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('refuses an invalid cron inline and disables Create without writing', async () => {
      const { user } = renderDialog();
      await reachTriggerStep(user);
      await user.click(screen.getByRole('radio', { name: 'Cron (advanced)' }));
      const cron = screen.getByLabelText('Cron');
      await user.clear(cron);
      await user.paste('61 * * * *');
      expect(
        screen.getAllByText(/not valid: "61" is out of range \(0\.\.59\)/)[0],
      ).toBeVisible();
      expect(
        screen.getByText('Fix the schedule above to see the next runs.'),
      ).toBeVisible();
      const create = screen.getByRole('button', { name: /Create automation/i });
      expect(create).toHaveAttribute('aria-disabled', 'true');
      await user.click(create);
      expect(saveAutomation).not.toHaveBeenCalled();
      expect(setTrigger).not.toHaveBeenCalled();

      // A four-field cron — the one the packaged parser used to accept.
      await user.clear(cron);
      await user.paste('*/1 * * *');
      expect(screen.getAllByText(/got 4/)[0]).toBeVisible();
      expect(create).toHaveAttribute('aria-disabled', 'true');
    });

    it('sends the schedule it showed', async () => {
      const { user } = renderDialog();
      await reachTriggerStep(user);
      await user.click(
        screen.getByRole('button', { name: /Create automation/i }),
      );
      expect(setTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: {
            kind: 'schedule',
            repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
            timezone: 'Europe/Zurich',
            catchUp: 'latest',
            // Off by default — the trigger is created paused (D-10).
            enabled: false,
          },
        }),
      );
    });

    it('sends a cron typed under Cron, as it reads', async () => {
      const { user } = renderDialog();
      await reachTriggerStep(user);
      await user.click(screen.getByRole('radio', { name: 'Cron (advanced)' }));
      const cron = screen.getByLabelText('Cron');
      await user.clear(cron);
      await user.paste('43 7 * * *');
      expect(screen.getByText(/^Reads as: Daily at 7:43/)).toBeVisible();
      await user.click(
        screen.getByRole('button', { name: /Create automation/i }),
      );
      expect(setTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: expect.objectContaining({
            kind: 'schedule',
            cron: '43 7 * * *',
            timezone: 'Europe/Zurich',
            enabled: false,
          }),
        }),
      );
    });

    it('arms the trigger only when Enable now is checked', async () => {
      const { user } = renderDialog();
      await reachTriggerStep(user);
      const enableNow = screen.getByRole('checkbox', { name: /Enable now/i });
      expect(enableNow).not.toBeChecked();
      await user.click(enableNow);
      await user.click(
        screen.getByRole('button', { name: /Create automation/i }),
      );
      expect(setTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: expect.objectContaining({ enabled: true }),
        }),
      );
    });
  },
);

/**
 * The typed name is the display name — the slug only addresses the
 * automation. The wizard used to send no presentation, so `eval-D-agent 测试
 * 🚀` became "Eval d agent" and a name outside the Latin script could not be
 * created at all (2026-09-26 evaluation, D-03).
 */
describe('BlankAutomationDialog display name', () => {
  it.each([
    [`${'a'.repeat(63)} b`, 'a'.repeat(63)],
    [`${'a'.repeat(62)} b`, `${'a'.repeat(62)}-b`],
    ['a'.repeat(65), 'a'.repeat(64)],
  ])(
    'generates a valid slug for a boundary name: %s',
    async (displayName, expectedSlug) => {
      const { user } = renderDialog();
      await user.type(screen.getByLabelText(/Name/i), displayName);
      await user.click(screen.getByRole('button', { name: /Agent model/i }));
      await user.click(screen.getByRole('option', { name: /^claude-fable-5/ }));
      await user.type(screen.getByLabelText(/What should it do\?/i), 'Scan');
      await user.click(screen.getByRole('button', { name: /Next/i }));
      await user.click(
        screen.getByRole('button', { name: /Create automation/i }),
      );

      expect(saveAutomation).toHaveBeenCalledWith(
        expect.objectContaining({
          automation: expect.objectContaining({ name: expectedSlug }),
        }),
      );
      expect(isValidAutomationName(expectedSlug)).toBe(true);
    },
  );

  it('keeps the typed name as the presentation and slugifies only the address', async () => {
    const { user } = renderDialog();
    await user.type(screen.getByLabelText(/Name/i), 'Eval-D agent 测试 🚀');
    expect(screen.getByText('Saved as: eval-d-agent')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Agent model/i }));
    await user.click(screen.getByRole('option', { name: /^claude-fable-5/ }));
    await user.type(screen.getByLabelText(/What should it do\?/i), 'Scan');
    await user.click(screen.getByRole('button', { name: /Next/i }));
    await user.click(
      screen.getByRole('button', { name: /Create automation/i }),
    );
    expect(saveAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: { name: 'Eval-D agent 测试 🚀' },
        automation: expect.objectContaining({ name: 'eval-d-agent' }),
      }),
    );
  });

  it('derives a generated slug for a name outside the Latin script and says so', async () => {
    const { user } = renderDialog();
    await user.type(screen.getByLabelText(/Name/i), '发票提醒');
    const hint = screen.getByText(/^Saved as: automation-[0-9a-f]{8}$/);
    expect(hint).toBeVisible();
    const slug = hint.textContent?.replace('Saved as: ', '') ?? '';
    await user.click(screen.getByRole('button', { name: /Agent model/i }));
    await user.click(screen.getByRole('option', { name: /^claude-fable-5/ }));
    await user.type(screen.getByLabelText(/What should it do\?/i), 'Scan');
    const next = screen.getByRole('button', { name: /Next/i });
    expect(next).toBeEnabled();
    await user.click(next);
    await user.click(
      screen.getByRole('button', { name: /Create automation/i }),
    );
    expect(saveAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: { name: '发票提醒' },
        automation: expect.objectContaining({ name: slug }),
      }),
    );
  });
});

/**
 * A webhook's token is minted by the create and shown by the server exactly
 * once — the wizard used to navigate straight past it, leaving Rotate as the
 * only way to a usable URL (2026-09-26 evaluation, D-13).
 */
describe('BlankAutomationDialog webhook URL', () => {
  it('shows the minted URL with a copy button before opening the automation', async () => {
    setTrigger.mockResolvedValueOnce({ token: 'wht_once_1' });
    const { user } = renderDialog();
    await reachTriggerStep(user);
    await user.click(screen.getByRole('radio', { name: /^Webhook/ }));
    expect(screen.getByText(/shown once, right after/)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: /Create automation/i }),
    );

    expect(await screen.findByText('Webhook URL — copy it now')).toBeVisible();
    expect(
      screen.getByText(/\/api\/automations\/webhook\/wht_once_1$/),
    ).toBeVisible();
    // The copy control is the pill itself, named by its label and value.
    expect(
      screen.getByRole('button', {
        name: /Webhook endpoint .*\/api\/automations\/webhook\/wht_once_1/,
      }),
    ).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Open the automation' }),
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ automationSlug: 'triage' }),
      }),
    );
  });

  // Created from a project's page, the automation is installed there, and
  // its webhook answers on the project's door only: the organization's URL
  // would start nothing.
  it('shows the project’s URL when the automation is created in a project', async () => {
    setTrigger.mockResolvedValueOnce({ token: 'wht_once_2' });
    const { user } = render(
      <BlankAutomationDialog
        organizationId="org-1"
        projectId="proj-7"
        open
        onOpenChange={vi.fn()}
      />,
    );
    await reachTriggerStep(user);
    await user.click(screen.getByRole('radio', { name: /^Webhook/ }));
    await user.click(
      screen.getByRole('button', { name: /Create automation/i }),
    );
    expect(
      await screen.findByRole('button', {
        name: /Webhook endpoint .*\/api\/projects\/proj-7\/automations\/webhook\/wht_once_2$/,
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Keep the URL in TALE_WEBHOOK_URL in the sending system; it works like a password.',
      ),
    ).toBeVisible();
  });

  // Created from Billing's page, an event trigger hears Billing's events
  // and those of no project, and says so before the automation exists.
  it('says which events reach an event trigger created in a project [AUTO-R35]', async () => {
    const { user } = render(
      <BlankAutomationDialog
        organizationId="org-1"
        projectId="proj-7"
        open
        onOpenChange={vi.fn()}
      />,
    );
    await reachTriggerStep(user);
    await user.click(screen.getByRole('radio', { name: /^Platform event/ }));
    expect(
      screen.getByText(
        'Starts for matching events in Billing, and for events that belong to no project, such as contacts.',
      ),
    ).toBeVisible();
  });

  it('opens the automation straight away for a schedule', async () => {
    const { user } = renderDialog();
    await reachTriggerStep(user);
    await user.click(
      screen.getByRole('button', { name: /Create automation/i }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Webhook URL — copy it now')).toBeNull();
  });
});

describe('BlankAutomationDialog model pin', () => {
  it('offers one option per (provider, model) pair, harness-filtered', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: /Agent model/i }));

    // Both copies stay separately pickable — the id-keyed dedupe is gone —
    // and the subscription copy names its serving lane.
    expect(
      screen.getByRole('option', { name: /anthropic\/claude-fable-5/ }),
    ).toBeVisible();
    const subscriptionRow = screen.getByRole('option', {
      name: /^claude-fable-5/,
    });
    expect(subscriptionRow).toBeVisible();
    expect(subscriptionRow.textContent).toContain('Anthropic · Subscription');
    // The scaffolded node runs on the DEFAULT harness (claude-code), so a
    // subscription entry bound to another harness is not offered.
    expect(screen.queryByRole('option', { name: /gpt-6-codex/ })).toBeNull();
  });

  it('stores the picked (model, modelProvider) pair on the scaffolded node', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText(/Name/i), 'Triage');
    await user.click(screen.getByRole('button', { name: /Agent model/i }));
    await user.click(screen.getByRole('option', { name: /^claude-fable-5/ }));
    await user.type(
      screen.getByLabelText(/What should it do\?/i),
      'Scan issues',
    );
    await user.click(screen.getByRole('button', { name: /Next/i }));
    await user.click(
      screen.getByRole('button', { name: /Create automation/i }),
    );

    expect(saveAutomation).toHaveBeenCalledTimes(1);
    const document = saveAutomation.mock.calls[0]?.[0]?.automation;
    expect(document?.nodes?.[0]).toMatchObject({
      model: 'claude-fable-5',
      modelProvider: 'anthropic',
    });
  });
});
