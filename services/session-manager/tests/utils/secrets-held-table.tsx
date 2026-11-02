// The Secrets table with its filters held the way the page holds them: one
// state, which the table changes and reads again. The table itself keeps no
// filters (the page keeps them in the address), so a test of the table needs
// somebody to hold them.

import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { expect } from 'vitest';

import { SecretsTable } from '@/app/features/secrets/components/secrets-table';
import {
  NO_FILTERS,
  type SecretsFilters,
} from '@/app/features/secrets/lib/filters';

interface HeldSecretsTableProps {
  initial?: SecretsFilters;
  /** What the address says of the search when the page opens. */
  initialQuery?: string;
  /** Every state the table asks for, in order. */
  onChange?: (filters: SecretsFilters) => void;
  /** Every search the table writes to the address, in order. */
  onQuery?: (query: string) => void;
}

export function HeldSecretsTable({
  initial = NO_FILTERS,
  initialQuery = '',
  onChange,
  onQuery,
}: HeldSecretsTableProps) {
  const [filters, setFilters] = useState(initial);
  const [query, setQuery] = useState(initialQuery);
  return (
    <SecretsTable
      filters={filters}
      onFiltersChange={(next) => {
        onChange?.(next);
        setFilters(next);
      }}
      query={query}
      onQueryChange={(next) => {
        onQuery?.(next);
        setQuery(next);
      }}
    />
  );
}

export const filterButton = () =>
  screen.getByRole('button', { name: 'Filter' });

export const filterPanel = () =>
  screen.queryByRole('dialog', { name: 'Filters' });

/** Opens the panel of the Filter button, if it is not open. */
export async function openFilterPanel(user: UserEvent): Promise<HTMLElement> {
  if (filterPanel() === null) await user.click(filterButton());
  return screen.findByRole('dialog', { name: 'Filters' });
}

export async function closeFilterPanel(user: UserEvent) {
  await user.keyboard('{Escape}');
  await waitFor(() => expect(filterPanel()).toBeNull());
}

/** Opens the panel and its group (they start closed), and chooses one option. */
export async function chooseFilter(
  user: UserEvent,
  group: string,
  option: string,
) {
  const panel = await openFilterPanel(user);
  const header = within(panel).getByRole('button', {
    name: (name) => name.startsWith(group),
  });
  if (header.getAttribute('aria-expanded') !== 'true') await user.click(header);
  await user.click(within(panel).getByRole('radio', { name: option }));
}

/** The options of a group of the panel, in order, with the one chosen. */
export async function optionsOf(
  user: UserEvent,
  group: string,
): Promise<{ options: string[]; chosen: string | undefined }> {
  const panel = await openFilterPanel(user);
  const header = within(panel).getByRole('button', {
    name: (name) => name.startsWith(group),
  });
  if (header.getAttribute('aria-expanded') !== 'true') await user.click(header);
  const radios = within(panel)
    .getAllByRole('radio')
    .filter(
      (radio) =>
        radio.closest('[role="radiogroup"]')?.getAttribute('aria-label') ===
        group,
    );
  return {
    options: radios.map((radio) => radio.textContent ?? ''),
    chosen:
      radios.find((radio) => radio.getAttribute('aria-checked') === 'true')
        ?.textContent ?? undefined,
  };
}

/** The button of a filter in force, which lifts it. */
export const chipOf = (text: string) =>
  screen.getByRole('button', { name: `Remove filter ${text}` });
