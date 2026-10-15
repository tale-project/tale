import { LocaleProvider } from '@tale/ui/i18n/locale-provider';
import { TooltipProvider } from '@tale/ui/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountState } from '@/app/lib/api';
import { i18n } from '@/lib/i18n/i18n';

import { StatusCell } from './status-cell';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function show(state: AccountState, limitedUntil: string | null) {
  return render(
    <LocaleProvider>
      <TooltipProvider>
        <StatusCell limitedUntil={limitedUntil} state={state} />
      </TooltipProvider>
    </LocaleProvider>,
  );
}

/** What the pointer is told: the cell's own words are hidden on a phone. */
async function tooltipOf(cell: HTMLElement): Promise<string> {
  const trigger = cell.querySelector('span');
  if (!trigger) throw new Error('The cell has no trigger');
  fireEvent.focus(trigger);
  return (await screen.findByRole('tooltip')).textContent ?? '';
}

describe('StatusCell', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says which state, and for a limited account when it comes back', () => {
    show('limited', at(3 * DAY));
    expect(screen.getByText('Limit reached')).toBeTruthy();
    expect(screen.getByText('Resets in 3 days')).toBeTruthy();
  });

  it('says only the state for every state that has no return to give', () => {
    for (const [state, label] of [
      ['available', 'Available'],
      ['expired', 'Needs reauthentication'],
      ['error', 'Last call failed'],
    ] as const) {
      const { unmount } = show(state, null);
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.queryByText(/Resets/)).toBeNull();
      unmount();
    }
  });

  it('puts the exact instant on the tooltip of a limited account', async () => {
    const { container } = show('limited', at(3 * DAY));
    expect(await tooltipOf(container)).toMatch(
      /^Limit reached · Resets October 18, 2026/,
    );
  });

  it('keeps the state on the tooltip when the return is not known, or is now', async () => {
    const unknown = show('limited', null);
    expect(await tooltipOf(unknown.container)).toBe(
      'Limit reached · Reset time unknown',
    );
    unknown.unmount();

    const now = show('limited', at(-MINUTE));
    expect(await tooltipOf(now.container)).toBe('Limit reached · Resets now');
  });

  it('names a state with nothing more to say on its tooltip, so a phone can read it', async () => {
    const { container } = show('error', null);
    expect(await tooltipOf(container)).toBe('Last call failed');
  });

  it('turns the hourglass into a timer, in the success tint, inside the hour only', () => {
    const soon = show('limited', at(25 * MINUTE));
    expect(
      soon.container.querySelector('svg')?.getAttribute('class'),
    ).toContain('text-success');
    soon.unmount();

    const later = show('limited', at(3 * DAY));
    expect(
      later.container.querySelector('svg')?.getAttribute('class'),
    ).not.toContain('text-success');
  });
});
