import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import {
  defaultTriggerDraft,
  draftFromStored,
  type TriggerDraft,
} from '../lib/trigger-draft';
import { TriggerForm } from './trigger-form';
import type { TriggerSurface } from './trigger-schedule-field';

function row(overrides: Partial<TriggerView>): TriggerView {
  return {
    id: 'trigger-1',
    name: 'weekly-report',
    kind: 'schedule',
    cron: null,
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
    ...overrides,
  };
}

/** The form over a draft it owns, the way its two hosts hold one. */
function Host({
  stored,
  surface = 'panel',
  initial,
  onDraft,
}: {
  stored: TriggerView | null;
  surface?: TriggerSurface;
  initial?: TriggerDraft;
  onDraft?: (draft: TriggerDraft) => void;
}) {
  const [draft, setDraft] = useState<TriggerDraft>(
    () =>
      initial ??
      (stored === null
        ? defaultTriggerDraft('UTC')
        : draftFromStored(stored, 'UTC')),
  );
  return (
    <TriggerForm
      surface={surface}
      draft={draft}
      stored={stored}
      canEdit
      viewerZone="UTC"
      runState={{ clean: true, deployed: true, nextRunAt: null }}
      onChange={(patch) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        onDraft?.(next);
      }}
    />
  );
}

const repeatRadio = () => screen.getByRole('radio', { name: 'Repeat' });
const cronRadio = () => screen.getByRole('radio', { name: 'Cron (advanced)' });

// UI §5.3: how each stored schedule opens, and what switching between
// Repeat and Cron says.
describe('Repeat | Cron', () => {
  it('opens a stored rule in Repeat with no note', () => {
    render(
      <Host
        stored={row({
          repeat: {
            frequency: 'weekly',
            interval: 1,
            weekdays: [1, 2, 3, 4, 5],
            times: ['09:00', '17:30'],
          },
          startDate: '2026-10-05',
        })}
      />,
    );
    expect(repeatRadio()).toBeChecked();
    expect(
      screen.getByText(/^Every weekday at 9:00/, { selector: 'p' }),
    ).toBeVisible();
    expect(screen.queryByText(/^Stored as the cron expression/)).toBeNull();
  });

  it('opens a cron a rule says exactly in Repeat, saying it is stored as cron', () => {
    render(<Host stored={row({ cron: '0 9 * * 1-5' })} />);
    expect(repeatRadio()).toBeChecked();
    expect(
      screen.getByText(
        'Stored as the cron expression 0 9 * * 1-5. Saving a change to the schedule stores it as a repeat rule.',
      ),
    ).toBeVisible();
  });

  it('opens any other cron in Cron, and says Repeat would replace it', async () => {
    render(<Host stored={row({ cron: '0 9 31 * *' })} />);
    expect(cronRadio()).toBeChecked();
    expect(screen.getByLabelText('Cron')).toHaveValue('0 9 31 * *');
    await userEvent.click(repeatRadio());
    expect(
      screen.getByText(
        "This cron expression can't be shown as a repeat. Saving in Repeat replaces it.",
      ),
    ).toBeVisible();
  });

  it('opens a new trigger as a daily 09:00 rule', () => {
    render(<Host stored={null} />);
    expect(repeatRadio()).toBeChecked();
    expect(
      screen.getByRole('button', { name: /^Schedule: Daily/ }),
    ).toBeVisible();
  });

  it('writes a rule one cron says as that cron, and reads it back', async () => {
    let latest: TriggerDraft | undefined;
    render(<Host stored={null} onDraft={(draft) => (latest = draft)} />);
    await userEvent.click(cronRadio());
    expect(screen.getByLabelText('Cron')).toHaveValue('0 9 * * *');
    expect(screen.getByText(/^Reads as: Daily at 9:00/)).toBeVisible();
    expect(latest?.scheduleFormat).toBe('cron');
  });

  it('says when no single cron says the rule', async () => {
    render(
      <Host
        stored={null}
        initial={{
          ...defaultTriggerDraft('UTC'),
          repeat: {
            frequency: 'minutely',
            interval: 30,
            window: {
              weekdays: [5],
              hours: { from: '22:00', to: '06:00' },
            },
          },
        }}
      />,
    );
    await userEvent.click(cronRadio());
    expect(screen.getByLabelText('Cron')).toHaveValue('');
    expect(
      screen.getByText(
        /has no single cron expression\. Enter one, or go back to Repeat\.$/,
      ),
    ).toBeVisible();
  });

  it('turns a cron a rule says into that rule when switching to Repeat', async () => {
    let latest: TriggerDraft | undefined;
    render(
      <Host
        stored={row({ cron: '0 9 31 * *' })}
        onDraft={(draft) => (latest = draft)}
      />,
    );
    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.paste('*/15 * * * *');
    await userEvent.click(repeatRadio());
    expect(latest?.repeat).toEqual({ frequency: 'minutely', interval: 15 });
    expect(
      screen.getByRole('button', { name: /^Schedule: Every 15 minutes/ }),
    ).toBeVisible();
  });
});

describe('the zone and the next runs', () => {
  it('refuses a zone nobody can resolve and has no runs to show', () => {
    render(
      <Host
        stored={null}
        initial={{ ...defaultTriggerDraft('UTC'), timezone: 'Mars/Olympus' }}
      />,
    );
    expect(
      screen.getByText(
        'Pick a valid IANA time zone (e.g. Europe/Zurich or UTC).',
      ),
    ).toBeVisible();
    expect(
      screen.getByText('Fix the schedule above to see the next runs.'),
    ).toBeVisible();
  });

  it('lists five runs on the tab and three in the wizard', () => {
    // A new trigger is off, so its runs would start rather than will.
    const { unmount } = render(<Host stored={null} />);
    expect(
      within(screen.getByRole('list', { name: /^Would run at/ })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(5);
    unmount();
    render(<Host stored={null} surface="wizard" />);
    expect(
      within(screen.getByRole('list', { name: /^Would run at/ })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(3);
  });
});

describe('panel and wizard', () => {
  it('offers the kind as a select and the missed-runs setting on the tab', () => {
    render(<Host stored={null} />);
    expect(
      screen.getByRole('combobox', { name: 'Trigger type' }),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Missed runs' })).toBeVisible();
    expect(
      screen.getByText(
        'Runs once for the most recent time it missed, however late. Earlier missed times are counted, not run.',
      ),
    ).toBeVisible();
  });

  it('asks for the kind with a hint per choice in the wizard, without missed runs', () => {
    render(<Host stored={null} surface="wizard" />);
    const kinds = screen.getByRole('radiogroup', { name: 'When does it run?' });
    expect(
      within(kinds).getByText(
        'When another system sends a request to its URL.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Missed runs' })).toBeNull();
  });

  it('switches the missed-runs hint with the setting', async () => {
    let latest: TriggerDraft | undefined;
    render(<Host stored={null} onDraft={(draft) => (latest = draft)} />);
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Missed runs' }),
    );
    await userEvent.click(screen.getByRole('option', { name: 'Skip them' }));
    expect(latest?.catchUp).toBe('skip');
    expect(
      screen.getByText(
        "A run more than 10 minutes late doesn't start; it's counted as missed.",
      ),
    ).toBeVisible();
  });
});
