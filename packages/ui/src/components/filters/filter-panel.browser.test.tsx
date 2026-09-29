import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen, waitFor } from '@/tests/utils/render';

import { SearchInput } from '../forms/search-input';
import { FilterPanel, isFilterAffordanceDisabled } from './filter-panel';

import '../../globals.css';

// Real-Chromium coverage for a filter bar that turns disabled under the
// reader's own hand, over a list with no rows: the search they erase and the
// facet they clear were all that kept it usable. A browser moves focus to the
// page the moment the focused control is disabled — jsdom never does — so only
// a real engine shows whether the reader keeps their place.
afterEach(cleanup);

/** An empty list whose search box and Filter are usable only while narrowed. */
function EmptyList({
  initialSearch = '',
  initialTags = [],
}: {
  initialSearch?: string;
  initialTags?: string[];
}) {
  const [search, setSearch] = useState(initialSearch);
  const [tags, setTags] = useState(initialTags);
  const disabled = isFilterAffordanceDisabled({
    itemCount: 0,
    hasActiveFilters: search !== '' || tags.length > 0,
  });
  return (
    <div className="flex gap-2 p-4">
      <SearchInput
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search"
        disabled={disabled}
      />
      <FilterPanel
        filters={[
          {
            key: 'tags',
            title: 'Tags',
            options: [
              { value: 'code', label: 'Code' },
              { value: 'messaging', label: 'Messaging' },
            ],
            selectedValues: tags,
            onChange: setTags,
            multiSelect: true,
          },
        ]}
        onClearAll={() => {
          setSearch('');
          setTags([]);
        }}
        disabled={disabled}
      />
      <button type="button">Next control</button>
    </div>
  );
}

const filterButton = () => screen.getByRole('button', { name: 'Filter' });

describe('A filter bar disabled under the reader (real focus)', () => {
  it('keeps focus on Filter when Clear all leaves nothing to narrow', async () => {
    const { user } = render(<EmptyList initialTags={['code']} />);
    await user.click(filterButton());
    await user.click(await screen.findByRole('button', { name: 'Clear all' }));

    await waitFor(() => expect(filterButton()).toHaveFocus());
    expect(filterButton()).toHaveAttribute('aria-disabled', 'true');
    // Still unavailable: pressing it opens nothing.
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Once the reader moves on, it leaves the tab order like any disabled button.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
    expect(filterButton()).toBeDisabled();
  });

  it('returns focus to Filter when Escape closes a panel disabled while open', async () => {
    const { user } = render(<EmptyList initialTags={['code']} />);
    await user.click(filterButton());
    await user.click(await screen.findByRole('button', { name: /^Tags/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Code' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(filterButton()).toHaveFocus());
    expect(filterButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('lets go of Filter when the reader dismisses the panel on another control', async () => {
    const { user } = render(<EmptyList initialTags={['code']} />);
    await user.click(filterButton());
    await user.click(await screen.findByRole('button', { name: /^Tags/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Code' }));

    await user.click(screen.getByRole('button', { name: 'Next control' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
    await waitFor(() => expect(filterButton()).toBeDisabled());
  });

  it('keeps the search box editable when erasing the query leaves nothing to search', async () => {
    const { user } = render(<EmptyList initialSearch="zz" />);
    const search = screen.getByRole('textbox', { name: 'Search' });
    await user.click(search);
    await user.keyboard('{End}{Backspace}{Backspace}');

    expect(search).toHaveFocus();
    expect(search).toBeEnabled();
    await user.keyboard('abc');
    expect(search).toHaveValue('abc');

    // Emptied again and left: now it is disabled.
    await user.clear(search);
    await user.tab();
    expect(search).toBeDisabled();
  });
});

/** A board toolbar: a control before Filter, a single-choice and a
 * multi-choice facet, and a control after it. */
function PriorityToolbar() {
  const [priority, setPriority] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  return (
    <div className="flex gap-2 p-4">
      <button type="button">Before</button>
      <FilterPanel
        filters={[
          {
            key: 'priority',
            title: 'Priority',
            options: [
              { value: 'p0', label: 'Urgent' },
              { value: 'p1', label: 'High' },
              { value: 'p2', label: 'Medium' },
            ],
            selectedValues: priority,
            onChange: setPriority,
          },
          {
            key: 'tags',
            title: 'Tags',
            options: [{ value: 'code', label: 'Code' }],
            selectedValues: tags,
            onChange: setTags,
            multiSelect: true,
          },
        ]}
        onClearAll={() => {
          setPriority([]);
          setTags([]);
        }}
      />
      <button type="button">After</button>
      <output data-testid="priority">{priority.join(',')}</output>
    </div>
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });

// #3746 in a real engine: the keyboard alone opens the panel, reaches a
// single-choice facet as one Tab stop, moves its choice with the arrow keys,
// and leaves it with Tab. Real key presses (CDP input, not synthetic events)
// with a key held while Radix moves the focus a task later.
describe('A single-choice facet by keyboard (real focus)', () => {
  it('opens into the panel, takes one Tab stop and follows the arrows', async () => {
    render(<PriorityToolbar />);
    await userEvent.tab();
    await userEvent.tab();
    expect(filterButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    const header = await screen.findByRole('button', { name: 'Priority' });
    await waitFor(() => expect(header).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    expect(radio('Urgent')).toHaveFocus();
    // The focused option shows the shared focus ring.
    expect(getComputedStyle(radio('Urgent')).boxShadow).not.toBe('none');
    expect(screen.getByTestId('priority')).toHaveTextContent('');

    await userEvent.keyboard('{ArrowDown>}');
    await waitFor(() => expect(radio('High')).toHaveFocus());
    await userEvent.keyboard('{/ArrowDown}');
    expect(radio('High')).toBeChecked();
    expect(screen.getByTestId('priority')).toHaveTextContent('p1');
    expect(
      screen.getAllByRole('radio').map((option) => option.tabIndex),
    ).toEqual([-1, 0, -1]);

    // A quick press, its key up before Radix's deferred focus lands (as on a
    // page still busy with the last choice), still takes the choice along.
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(radio('Medium')).toHaveFocus());
    await waitFor(() => expect(radio('Medium')).toBeChecked());
    await userEvent.keyboard('{ArrowUp}');
    await waitFor(() => expect(radio('High')).toHaveFocus());
    await waitFor(() => expect(radio('High')).toBeChecked());
    expect(screen.getByTestId('priority')).toHaveTextContent('p1');

    // Tab leaves the group for the next facet; Shift+Tab returns to the
    // chosen option; Escape closes the panel onto Filter.
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(radio('High')).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(screen.getByTestId('priority')).toHaveTextContent('');
    expect(radio('High')).not.toBeChecked();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(filterButton()).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
