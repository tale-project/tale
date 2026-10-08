import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

import { render, screen, within } from '@/tests/utils/render';

import {
  IssueDetail,
  IssueList,
  type IssueItem,
  type IssueListHandle,
} from './issue-list';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const ISSUES: IssueItem[] = [
  {
    id: 'unknown-node',
    severity: 'error',
    title: 'Reads a node that does not exist',
    location: 'Draft reply › Prompt',
    explanation: 'A template can only read nodes of this automation.',
    cause: 'The prompt reads "nope", and there is no such node.',
    fix: 'Read one of the nodes listed in the inspector.',
    code: 'REF_UNKNOWN_NODE',
    technical: 'nodes.nope is not a node of this automation',
    docsHref: 'https://docs.tale.dev/platform/automations/concepts',
  },
  {
    id: 'maybe-empty',
    severity: 'warning',
    title: 'The output can be empty',
    location: 'Automation output',
    fix: 'Give the output a fallback value.',
    code: 'OUTPUT_MAYBE_EMPTY',
    unavailableReason: 'Change the output in the YAML view.',
  },
  {
    id: 'never-true',
    severity: 'warning',
    title: 'This condition is never true',
    location: 'Triage › Condition',
    fix: 'Compare against a value the field can hold.',
  },
];

function rowOf(name: RegExp) {
  return screen.getByRole('button', { name });
}

describe('IssueList — keyboard', () => {
  it('is one tab stop that the arrows, Home and End move through', async () => {
    render(
      <>
        <IssueList issues={ISSUES} onActivate={() => {}} />
        <button type="button">After the list</button>
      </>,
    );
    const rows = within(screen.getByRole('list')).getAllByRole('button');
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
  });

  it('tabs from the current row through its own details, then out', async () => {
    render(
      <>
        <IssueList issues={ISSUES} onActivate={() => {}} />
        <button type="button">After the list</button>
      </>,
    );
    await userEvent.keyboard('{Tab}');
    expect(rowOf(/Reads a node/)).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toHaveTextContent('Technical details');
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('link', { name: /Learn more/ })).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(
      screen.getByRole('button', { name: 'After the list' }),
    ).toHaveFocus();
  });

  it('activates a row with Enter, Space and a click', async () => {
    const onActivate = vi.fn();
    render(<IssueList issues={ISSUES} onActivate={onActivate} />);
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{End}');
    await userEvent.keyboard(' ');
    await userEvent.click(rowOf(/Reads a node/));
    expect(onActivate.mock.calls.map(([issue]) => issue.id)).toEqual([
      'unknown-node',
      'never-true',
      'unknown-node',
    ]);
  });

  it('keeps a row it cannot go to reachable, says why, and does nothing', async () => {
    const onActivate = vi.fn();
    render(<IssueList issues={ISSUES} onActivate={onActivate} />);
    const row = rowOf(/The output can be empty/);
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveAccessibleDescription(
      'Change the output in the YAML view.',
    );
    expect(
      screen.getByText('Change the output in the YAML view.'),
    ).toBeVisible();
    await userEvent.keyboard('{Tab}');
    await userEvent.keyboard('{ArrowDown}');
    expect(row).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    // Playwright refuses to click an aria-disabled element; a pointer still can.
    row.click();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('names a row by severity, title and location, and describes it', () => {
    render(<IssueList issues={ISSUES} onActivate={() => {}} />);
    const row = rowOf(/Reads a node/);
    expect(row).toHaveAccessibleName(
      'Error: Reads a node that does not exist Draft reply › Prompt',
    );
    expect(row).toHaveAccessibleDescription(
      'A template can only read nodes of this automation. The prompt reads "nope", and there is no such node.',
    );
  });

  it('marks the row the host shows and starts the tab stop there', async () => {
    render(
      <IssueList issues={ISSUES} onActivate={() => {}} activeId="never-true" />,
    );
    const row = rowOf(/never true/);
    expect(row).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{Tab}');
    expect(row).toHaveFocus();
  });

  it('focuses a row through its handle', () => {
    const ref = createRef<IssueListHandle>();
    render(<IssueList ref={ref} issues={ISSUES} onActivate={() => {}} />);
    ref.current?.focus('never-true');
    expect(rowOf(/never true/)).toHaveFocus();
    ref.current?.focus('gone');
    expect(rowOf(/never true/)).toHaveFocus();
  });
});

describe('IssueList — static', () => {
  it('renders text rows with their details in the normal tab order', async () => {
    render(<IssueList issues={ISSUES} aria-label="Problems in this step" />);
    const list = screen.getByRole('list', { name: 'Problems in this step' });
    expect(within(list).queryAllByRole('button')).toEqual([]);
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toHaveTextContent('Technical details');
  });
});

describe('IssueList — states', () => {
  it('says "No problems" when the list is empty', () => {
    render(<IssueList issues={[]} />);
    expect(screen.getByText('No problems')).toBeVisible();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('marks the list busy and dims it while a check runs', () => {
    const { container } = render(
      <IssueList issues={ISSUES} status="checking" />,
    );
    expect(container.querySelector('[data-slot="issue-list"]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('list')).toHaveClass('opacity-60');
  });

  it('says a check failed above what it still lists, at full contrast', () => {
    render(<IssueList issues={ISSUES} status="failed" />);
    expect(
      screen.getByText(
        "Couldn't check for problems. The list may be out of date.",
      ),
    ).toBeVisible();
    expect(screen.getByRole('list')).not.toHaveClass('opacity-60');
  });

  it('shows only the title, location and fix when compact', () => {
    render(<IssueList issues={ISSUES} density="compact" />);
    expect(
      screen.getByText('Read one of the nodes listed in the inspector.'),
    ).toBeVisible();
    expect(
      screen.queryByText('A template can only read nodes of this automation.'),
    ).toBeNull();
    expect(screen.queryByText('Technical details')).toBeNull();
  });
});

describe('IssueDetail', () => {
  it('renders nothing for an issue without detail', () => {
    const { container } = render(
      <IssueDetail issue={{ id: 'x', severity: 'info', title: 'Note' }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hosts the caller's own actions", () => {
    render(
      <IssueDetail
        issue={ISSUES[2]!}
        actions={<button type="button">Open the run</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Open the run' })).toBeVisible();
  });
});

describe.each(['light', 'dark'])('IssueList contrast (%s)', (theme) => {
  it.each(['bg-background', 'bg-card', 'bg-muted'])(
    'keeps every row readable on %s',
    async (surface) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className={`${surface} text-foreground w-[32rem]`}>
          <IssueList
            issues={ISSUES}
            onActivate={() => {}}
            activeId="never-true"
          />
          <IssueList issues={[]} />
          <IssueList issues={ISSUES.slice(0, 1)} status="failed" />
        </div>,
      );
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

describe('IssueList — motion', () => {
  it('fades the "go to" hint and the dim by opacity alone', () => {
    render(
      <IssueList issues={ISSUES} onActivate={() => {}} status="checking" />,
    );
    const list = screen.getByRole('list');
    const hint = within(rowOf(/Reads a node/)).getByText('Go to');
    for (const element of [list, hint]) {
      expect(getComputedStyle(element).transitionProperty).toBe('opacity');
    }
  });

  it('switches both off under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    render(
      <IssueList issues={ISSUES} onActivate={() => {}} status="checking" />,
    );
    const list = screen.getByRole('list');
    const hint = within(rowOf(/Reads a node/)).getByText('Go to');
    for (const element of [list, hint]) {
      expect(getComputedStyle(element).transitionProperty).toBe('none');
    }
  });
});
