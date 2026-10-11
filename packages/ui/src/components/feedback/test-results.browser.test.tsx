import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

import { render, screen, within } from '@/tests/utils/render';

import {
  TestCountButton,
  TestCoverage,
  TestResultList,
  TestRunAnnouncer,
  type TestCounts,
  type TestResultItem,
  type TestResultListHandle,
  type TestRunAnnouncerProps,
} from './test-results';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const ITEMS: TestResultItem[] = [
  {
    id: 'big-order',
    name: 'Big order gets a discount',
    status: 'failed',
    reason: 'The output differs from what the test expects in 1 place.',
    meta: '120 ms',
    badges: <span className="text-xs">Simulates 2 nodes</span>,
  },
  {
    id: 'small-order',
    name: 'Small order pays full price',
    status: 'passed',
    meta: '84 ms',
  },
  {
    id: 'no-customer',
    name: 'An order without a customer is refused',
    status: 'error',
    reason: 'The test couldn’t run: the input is not valid.',
  },
];

const NONE: TestCounts = {
  passed: 0,
  failed: 0,
  error: 0,
  notRun: 0,
  stale: 0,
  total: 0,
};

function rowOf(name: RegExp) {
  return screen.getByRole('button', { name });
}

function rowActions(item: TestResultItem, row: { tabIndex: 0 | -1 }) {
  return (
    <button
      type="button"
      tabIndex={row.tabIndex}
      aria-label={`More for ${item.id}`}
      className="size-8"
    >
      …
    </button>
  );
}

describe('TestResultList — keyboard', () => {
  it('is one tab stop that the arrows, Home and End move through', async () => {
    render(
      <>
        <TestResultList items={ITEMS} onActivate={() => {}} />
        <button type="button">After the list</button>
      </>,
    );
    const list = screen.getByRole('list', { name: 'Test results' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);

    await userEvent.keyboard('{Tab}');
    expect(rows[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
    await userEvent.keyboard('{End}');
    expect(rows[2]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(rows[2]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(rows[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(rows[0]).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(
      screen.getByRole('button', { name: 'After the list' }),
    ).toHaveFocus();
  });

  it('activates a row with Enter, Space and a click', async () => {
    const onActivate = vi.fn();
    render(<TestResultList items={ITEMS} onActivate={onActivate} />);
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{End}');
    await userEvent.keyboard(' ');
    await userEvent.click(rowOf(/Small order/));
    expect(onActivate.mock.calls.map(([item]) => item.id)).toEqual([
      'big-order',
      'no-customer',
      'small-order',
    ]);
  });

  it('tabs from the current row to its own actions, then out', async () => {
    render(
      <>
        <TestResultList
          items={ITEMS}
          onActivate={() => {}}
          renderActions={rowActions}
        />
        <button type="button">After the list</button>
      </>,
    );
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{ArrowDown}');
    expect(rowOf(/Small order/)).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(
      screen.getByRole('button', {
        name: 'More for small-order',
      }),
    ).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(
      screen.getByRole('button', { name: 'After the list' }),
    ).toHaveFocus();
  });

  it('makes a row current when one of its actions is clicked', async () => {
    render(
      <TestResultList
        items={ITEMS}
        onActivate={() => {}}
        renderActions={rowActions}
      />,
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'More for no-customer',
      }),
    );
    expect(rowOf(/without a customer/)).toHaveAttribute('tabindex', '0');
    expect(rowOf(/Big order/)).toHaveAttribute('tabindex', '-1');
  });

  it('names a row by its status word, name and reason', () => {
    render(<TestResultList items={ITEMS} onActivate={() => {}} />);
    expect(rowOf(/Big order/)).toHaveAccessibleName(
      'Failed: Big order gets a discount The output differs from what the test expects in 1 place. Simulates 2 nodes 120 ms',
    );
    expect(rowOf(/Small order/)).toHaveAccessibleName(
      'Passed: Small order pays full price 84 ms',
    );
    expect(rowOf(/without a customer/)).toHaveAccessibleName(
      "Couldn't run: An order without a customer is refused The test couldn’t run: the input is not valid.",
    );
  });

  it('marks the row the host shows and starts the tab stop there', async () => {
    render(
      <TestResultList
        items={ITEMS}
        onActivate={() => {}}
        activeId="no-customer"
      />,
    );
    const row = rowOf(/without a customer/);
    expect(row).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{Tab}');
    expect(row).toHaveFocus();
  });

  it('focuses a row through its handle', () => {
    const ref = createRef<TestResultListHandle>();
    render(<TestResultList ref={ref} items={ITEMS} onActivate={() => {}} />);
    ref.current?.focus('small-order');
    expect(rowOf(/Small order/)).toHaveFocus();
    ref.current?.focus('gone');
    expect(rowOf(/Small order/)).toHaveFocus();
  });
});

describe('TestResultList — static', () => {
  it('renders text rows, their actions in the normal tab order', async () => {
    render(
      <TestResultList
        items={ITEMS}
        aria-label="Tests of version 4"
        renderActions={rowActions}
      />,
    );
    const list = screen.getByRole('list', { name: 'Tests of version 4' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByRole('button')).toHaveLength(3);
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toHaveAccessibleName('More for big-order');
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toHaveAccessibleName('More for small-order');
  });

  it('says every status in words, never by colour alone', () => {
    const statuses = [
      ['passed', 'Passed'],
      ['failed', 'Failed'],
      ['error', "Couldn't run"],
      ['running', 'Running'],
      ['queued', 'Waiting'],
      ['not-run', 'Not run yet'],
      ['stale', 'Changed since this result'],
    ] as const;
    render(
      <TestResultList
        items={statuses.map(([status]) => ({
          id: status,
          name: `Test ${status}`,
          status,
        }))}
        onActivate={() => {}}
      />,
    );
    const rows = within(screen.getByRole('list')).getAllByRole('button');
    // The name leads with the word once, whatever the row shows.
    expect(rows).toHaveLength(statuses.length);
    statuses.forEach(([status, word], index) => {
      expect(rows[index]).toHaveAccessibleName(`${word}: Test ${status}`);
    });
    // On screen a tick and a cross say themselves; every other status
    // writes its word on the trailing edge.
    const shown = rows.map(
      (row) =>
        row.querySelector('[data-slot="test-status-word"]')?.textContent ??
        null,
    );
    expect(shown).toEqual(
      statuses.map(([status, word]) =>
        status === 'passed' || status === 'failed' ? null : word,
      ),
    );
  });

  it('keeps the word beside a reason the result carries over', () => {
    render(
      <TestResultList
        items={[
          {
            id: 'old',
            name: 'Refund',
            status: 'stale',
            reason: 'The output differs from what the test expects in 1 place.',
            meta: '95 ms',
          },
        ]}
      />,
    );
    expect(screen.getByText('Changed since this result')).toBeVisible();
    expect(
      screen.getByText(
        'The output differs from what the test expects in 1 place.',
      ),
    ).toBeVisible();
    expect(screen.getByText('95 ms')).toBeVisible();
  });
});

describe('TestResultList — states', () => {
  it('says "No tests" when the list is empty', () => {
    render(<TestResultList items={[]} />);
    expect(screen.getByText('No tests')).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says the tests are running, not "No tests", while an empty list runs', () => {
    render(<TestResultList items={[]} status="running" />);
    expect(screen.getByText('Running the tests…')).toBeVisible();
    expect(screen.queryByText('No tests')).toBeNull();
  });

  it('marks the list busy while tests run, at full contrast', () => {
    const { container } = render(
      <TestResultList items={ITEMS} status="running" />,
    );
    const root = container.querySelector('[data-slot="test-result-list"]');
    expect(root).toHaveAttribute('aria-busy', 'true');
    expect(getComputedStyle(screen.getByRole('list')).opacity).toBe('1');
  });

  it('says a run failed above what it still lists', () => {
    render(<TestResultList items={ITEMS} status="failed" />);
    expect(
      screen.getByText(
        "Couldn't run the tests. The results may be out of date.",
      ),
    ).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('leaves the badges out when compact', () => {
    render(<TestResultList items={ITEMS} density="compact" />);
    expect(screen.queryByText('Simulates 2 nodes')).toBeNull();
    expect(
      screen.getByText(
        'The output differs from what the test expects in 1 place.',
      ),
    ).toBeVisible();
  });
});

describe('TestResultList — width', () => {
  it('fits a 375px phone: names wrap, rows are 36px or taller, nothing scrolls sideways', async () => {
    await cdp().send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 740,
      deviceScaleFactor: 2,
      mobile: true,
    });
    try {
      const { container } = render(
        <div className="w-[375px]">
          <TestResultList
            items={[
              {
                ...ITEMS[0]!,
                name: 'A very long test name that has to wrap onto a second line on a phone',
              },
              ...ITEMS.slice(1),
            ]}
            onActivate={() => {}}
            renderActions={rowActions}
          />
        </div>,
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      for (const row of within(screen.getByRole('list')).getAllByRole(
        'listitem',
      )) {
        expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(36);
        expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(375);
      }
      const name = screen.getByText(/A very long test name/);
      expect(name.getBoundingClientRect().height).toBeGreaterThan(20);
    } finally {
      await cdp().send('Emulation.clearDeviceMetricsOverride');
    }
  });
});

describe('TestResultList — motion', () => {
  /** The status glyph of the row named `name`. */
  function statusGlyph(name: RegExp) {
    return rowOf(name).querySelector<HTMLElement>('[data-status]');
  }

  it('fades a changed status in, the row the same height from waiting to its result', () => {
    const at = (status: TestResultItem['status'], meta?: string) => [
      ITEMS[0]!,
      { id: 'small-order', name: 'Small order pays full price', status, meta },
    ];
    const { rerender } = render(
      <div className="w-[32rem]">
        <TestResultList items={at('not-run')} onActivate={() => {}} />
      </div>,
    );
    const row = rowOf(/Small order/);
    const first = row.getBoundingClientRect();
    for (const [status, meta] of [
      ['queued'],
      ['running'],
      ['passed', '84 ms'],
    ] as const) {
      rerender(
        <div className="w-[32rem]">
          <TestResultList items={at(status, meta)} onActivate={() => {}} />
        </div>,
      );
      const glyph = statusGlyph(/Small order/);
      expect(glyph).toHaveAttribute('data-status', status);
      expect(getComputedStyle(glyph!).animationName).not.toBe('none');
      const now = row.getBoundingClientRect();
      expect(now.top).toBe(first.top);
      expect(now.height).toBe(first.height);
    }
  });

  it('shows a changed status at once, and stops the spinner, under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    render(
      <TestResultList
        items={[{ id: 'a', name: 'Runs now', status: 'running' }]}
        onActivate={() => {}}
      />,
    );
    const glyph = document.querySelector<HTMLElement>(
      '[data-status="running"]',
    );
    expect(getComputedStyle(glyph!).animationName).toBe('none');
    const spinner = glyph!.querySelector('svg');
    expect(getComputedStyle(spinner!).animationName).toBe('none');
  });
});

describe.each(['light', 'dark'])('test results contrast (%s)', (theme) => {
  it.each(['bg-background', 'bg-card', 'bg-muted'])(
    'keeps every row, count and coverage readable on %s',
    async (surface) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className={`${surface} text-foreground w-[32rem]`}>
          <TestResultList
            items={[
              ...ITEMS,
              { id: 'q', name: 'Waits', status: 'queued' },
              { id: 'n', name: 'Not yet', status: 'not-run' },
              {
                id: 's',
                name: 'Old',
                status: 'stale',
                reason: 'Changed since this result',
              },
            ]}
            onActivate={() => {}}
            activeId="small-order"
          />
          <TestResultList items={[]} />
          <TestResultList items={ITEMS.slice(0, 1)} status="failed" />
          <TestCountButton
            counts={{ ...NONE, passed: 2, failed: 1, error: 1, total: 4 }}
          />
          <TestCoverage covered={2} total={3} onActivate={() => {}} />
        </div>,
      );
      // Let the fades and pops finish: axe reads the colour at rest.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const result = await axe.run(container, {
        runOnly: ['color-contrast', 'aria-allowed-attr', 'button-name', 'list'],
      });
      expect(result.violations).toEqual([]);
      expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
        true,
      );
    },
  );
});

describe('TestCountButton', () => {
  it('keeps its width while tests run', () => {
    const counts = { ...NONE, passed: 2, failed: 1, total: 3 };
    const { rerender } = render(<TestCountButton counts={counts} />);
    const button = screen.getByRole('button');
    const idle = button.getBoundingClientRect().width;
    rerender(<TestCountButton counts={counts} status="running" />);
    expect(button.getBoundingClientRect().width).toBe(idle);
  });

  it('pops a changed count, and holds it still under reduced motion', async () => {
    const { container, rerender } = render(
      <TestCountButton counts={{ ...NONE, passed: 1, total: 1 }} />,
    );
    const popping = () => [
      ...container.querySelectorAll<HTMLElement>('.animate-in'),
    ];
    expect(popping()).toHaveLength(1);
    expect(getComputedStyle(popping()[0]!).animationName).not.toBe('none');
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    rerender(<TestCountButton counts={{ ...NONE, passed: 2, total: 2 }} />);
    expect(getComputedStyle(popping()[0]!).animationName).toBe('none');
  });
});

describe('TestRunAnnouncer', () => {
  const props = (
    overrides: Partial<TestRunAnnouncerProps>,
  ): TestRunAnnouncerProps => ({
    counts: { ...NONE, passed: 2, failed: 1, total: 3 },
    status: 'idle',
    announceKey: 'a',
    ...overrides,
  });

  function announced(): string {
    return screen.getByRole('status').textContent ?? '';
  }

  it('is a polite, atomic, visually hidden status region', () => {
    render(<TestRunAnnouncer {...props({})} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveClass('sr-only');
  });

  it('says nothing for the run it mounts with', () => {
    render(<TestRunAnnouncer {...props({ status: 'running' })} />);
    expect(announced()).toBe('');
  });

  it('says a run starting once, then its result once', () => {
    const { rerender } = render(<TestRunAnnouncer {...props({})} />);
    rerender(
      <TestRunAnnouncer {...props({ announceKey: 'b', status: 'running' })} />,
    );
    expect(announced()).toBe('Running 3 tests…');
    const started = screen.getByRole('status').firstElementChild;
    // New counts while the same run goes on are not news.
    rerender(
      <TestRunAnnouncer
        {...props({
          announceKey: 'b',
          status: 'running',
          counts: { ...NONE, passed: 1, total: 3 },
        })}
      />,
    );
    expect(screen.getByRole('status').firstElementChild).toBe(started);
    rerender(<TestRunAnnouncer {...props({ announceKey: 'b' })} />);
    expect(announced()).toBe('2 passed, 1 failed');
    const settled = screen.getByRole('status').firstElementChild;
    rerender(<TestRunAnnouncer {...props({ announceKey: 'b' })} />);
    expect(screen.getByRole('status').firstElementChild).toBe(settled);
  });

  it('leaves a failed run to the host, and leads with the context when given', () => {
    const { rerender } = render(<TestRunAnnouncer {...props({})} />);
    rerender(
      <TestRunAnnouncer {...props({ announceKey: 'b', status: 'failed' })} />,
    );
    expect(announced()).toBe('');
    rerender(
      <TestRunAnnouncer
        {...props({ announceKey: 'c', context: 'Saved version 4' })}
      />,
    );
    expect(announced()).toBe('Saved version 4. 2 passed, 1 failed');
  });

  it('replaces the region content for a repeated sentence, so it is spoken again', () => {
    const { rerender } = render(<TestRunAnnouncer {...props({})} />);
    rerender(<TestRunAnnouncer {...props({ announceKey: 'b' })} />);
    const first = screen.getByRole('status').firstElementChild;
    rerender(<TestRunAnnouncer {...props({ announceKey: 'c' })} />);
    const second = screen.getByRole('status').firstElementChild;
    expect(second).toHaveTextContent('2 passed, 1 failed');
    expect(second).not.toBe(first);
  });
});
