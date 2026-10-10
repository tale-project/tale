import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { Sparkles } from 'lucide-react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, within } from '@/tests/utils/render';

import {
  ChangeKindBadge,
  ChangeList,
  ChangeSummary,
  FieldChangeRow,
  type ChangeListHandle,
  type ChangeSection,
} from './change-list';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const SECTIONS: ChangeSection[] = [
  {
    id: 'start',
    title: 'Start (run inputs)',
    items: [
      {
        id: 'input:label',
        kind: 'added',
        title: 'label',
        subtitle: 'Run input',
        detail: (
          <FieldChangeRow label="Type" kind="added" after="text, required" />
        ),
      },
    ],
  },
  {
    id: 'nodes',
    title: 'Nodes',
    description: 'In the order they run.',
    items: [
      {
        id: 'score',
        kind: 'changed',
        title: 'Score',
        subtitle: 'Language model',
        summary: 'Model changed',
        icon: Sparkles,
        detail: (
          <FieldChangeRow
            label="Model"
            kind="changed"
            before="claude-haiku-4-5"
            after="claude-sonnet-4-5"
          />
        ),
      },
      {
        id: 'notify',
        kind: 'removed',
        title: 'Notify',
        subtitle: 'Slack · Send message',
      },
      {
        id: 'report',
        kind: 'renamed',
        title: 'Report',
        summary: 'Was Summary',
        detail: <p>Also updated in 2 nodes that read it.</p>,
      },
    ],
  },
  { id: 'tests', title: 'Tests', items: [] },
];

const rowOf = (name: RegExp) => screen.getByRole('button', { name });

describe('ChangeKindBadge', () => {
  it('says each kind in words beside its glyph', () => {
    render(
      <>
        {(['added', 'removed', 'changed', 'renamed'] as const).map((kind) => (
          <ChangeKindBadge key={kind} kind={kind} />
        ))}
      </>,
    );
    const badges = document.querySelectorAll('[data-slot="change-kind-badge"]');
    expect([...badges].map((badge) => badge.textContent)).toEqual([
      'Added',
      'Removed',
      'Changed',
      'Renamed',
    ]);
    for (const badge of badges) {
      expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(getComputedStyle(badge).height).toBe('20px');
    }
  });
});

describe('ChangeSummary', () => {
  it('reads the counts and flags as words, leaving out what did not happen', () => {
    render(
      <ChangeSummary
        counts={{ added: 2, removed: 1, changed: 3, renamed: 0 }}
        flags={['Inputs', 'Tests']}
        aria-label="Changes from v4 to v5"
      />,
    );
    const group = screen.getByRole('group', { name: 'Changes from v4 to v5' });
    expect(group).toHaveTextContent('2 added·1 removed·3 changed·Inputs·Tests');
    expect(group.querySelector('[data-kind="renamed"]')).toBeNull();
  });

  it('lists the same as chips, and says when nothing changed', () => {
    render(
      <ChangeSummary
        counts={{ added: 1 }}
        flags={['Tests']}
        variant="chips"
        aria-label="Summary"
      />,
    );
    const list = screen.getByRole('list', { name: 'Summary' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1 added', 'Tests']);
    cleanup();
    render(<ChangeSummary counts={{}} />);
    expect(screen.getByText('No changes')).toBeVisible();
  });
});

describe('FieldChangeRow', () => {
  it('says what a field was and what it is, inline or stacked', () => {
    render(
      <>
        <FieldChangeRow
          label="Model"
          kind="changed"
          before="claude-haiku-4-5"
          after="claude-sonnet-4-5"
        />
        <FieldChangeRow
          label="Retries"
          kind="added"
          before="ignored"
          after="3"
          layout="stacked"
          note="Only when the call fails."
        />
      </>,
    );
    const [inline, stacked] = document.querySelectorAll<HTMLElement>(
      '[data-slot="field-change-row"]',
    );
    expect(inline?.querySelector('del')).toHaveTextContent(
      'Before claude-haiku-4-5',
    );
    expect(inline?.querySelector('ins')).toHaveTextContent(
      'After claude-sonnet-4-5',
    );
    expect(
      getComputedStyle(inline?.querySelector('del') as Element)
        .textDecorationLine,
    ).toBe('none');
    // An added field has no value before.
    expect(stacked?.querySelector('del')).toBeNull();
    expect(
      within(stacked as HTMLElement)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['After']);
    expect(stacked).toHaveTextContent('Only when the call fails.');
  });
});

describe('ChangeList', () => {
  it('groups the items under their sections and leaves out an empty one', () => {
    render(<ChangeList sections={SECTIONS} aria-label="Changes" />);
    const group = screen.getByRole('group', { name: 'Changes' });
    expect(
      within(group)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Start (run inputs)1', 'Nodes3']);
    expect(screen.getByRole('region', { name: 'Nodes 3' })).toHaveTextContent(
      'In the order they run.',
    );
    // Each row's name says its kind in words.
    expect(rowOf(/Score/)).toHaveAccessibleName(
      'Changed Score Language model Model changed',
    );
    // A row with nothing to open and nothing to do is not a control.
    expect(screen.queryByRole('button', { name: /Notify/ })).toBeNull();
    expect(screen.getByText('Notify')).toBeVisible();
  });

  it('is one Tab stop the arrows, Home and End walk across sections', async () => {
    render(
      <>
        <ChangeList sections={SECTIONS} aria-label="Changes" />
        <button type="button">After the list</button>
      </>,
    );
    const rows = [rowOf(/label/), rowOf(/Score/), rowOf(/Report/)];
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

  it('opens a row with Enter or Space, its action one Tab away', async () => {
    const onActivate = vi.fn();
    render(
      <ChangeList
        sections={SECTIONS}
        aria-label="Changes"
        onActivate={onActivate}
        activateLabel="Show on the graph"
      />,
    );
    const score = rowOf(/Score/);
    expect(score).toHaveAttribute('aria-expanded', 'false');
    score.focus();
    await userEvent.keyboard('{Enter}');
    expect(score).toHaveAttribute('aria-expanded', 'true');
    const detail = document.getElementById(
      score.getAttribute('aria-controls') ?? '',
    );
    expect(detail).toHaveTextContent('claude-sonnet-4-5');
    await userEvent.keyboard('{Tab}');
    expect(
      screen.getByRole('button', { name: 'Show on the graph' }),
    ).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'score' }),
    );
    score.focus();
    await userEvent.keyboard(' ');
    expect(score).toHaveAttribute('aria-expanded', 'false');
    // A row with nothing to open does its action when chosen.
    await userEvent.click(rowOf(/Notify/));
    expect(onActivate).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'notify' }),
    );
  });

  it('opens the first or every row at first, or the host’s', async () => {
    render(
      <ChangeList
        sections={SECTIONS}
        aria-label="First"
        defaultExpanded="first"
      />,
    );
    expect(rowOf(/label/)).toHaveAttribute('aria-expanded', 'true');
    expect(rowOf(/Score/)).toHaveAttribute('aria-expanded', 'false');
    cleanup();
    render(
      <ChangeList sections={SECTIONS} aria-label="All" defaultExpanded="all" />,
    );
    expect(rowOf(/Score/)).toHaveAttribute('aria-expanded', 'true');
    expect(rowOf(/Report/)).toHaveAttribute('aria-expanded', 'true');
    cleanup();
    const onExpandedChange = vi.fn();
    function Held() {
      const [open, setOpen] = useState<ReadonlySet<string>>(
        () => new Set(['report']),
      );
      return (
        <ChangeList
          sections={SECTIONS}
          aria-label="Held"
          expanded={open}
          onExpandedChange={(ids) => {
            onExpandedChange([...ids]);
            setOpen(ids);
          }}
        />
      );
    }
    render(<Held />);
    expect(rowOf(/Report/)).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(rowOf(/Score/));
    expect(onExpandedChange).toHaveBeenLastCalledWith(['report', 'score']);
    expect(rowOf(/Score/)).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks the row the host shows and focuses a row it names', () => {
    const ref = createRef<ChangeListHandle>();
    render(
      <ChangeList
        ref={ref}
        sections={SECTIONS}
        aria-label="Changes"
        activeId="report"
      />,
    );
    expect(rowOf(/Report/)).toHaveAttribute('aria-current', 'true');
    expect(rowOf(/Report/).tabIndex).toBe(0);
    ref.current?.focus('score');
    expect(rowOf(/Score/)).toHaveFocus();
    ref.current?.focus();
    expect(rowOf(/Score/)).toHaveFocus();
  });

  it('says when nothing changed', () => {
    render(
      <ChangeList
        sections={[{ id: 'nodes', title: 'Nodes', items: [] }]}
        aria-label="Changes"
        emptyMessage="Only the message is different."
      />,
    );
    expect(screen.getByText('Only the message is different.')).toBeVisible();
  });

  it('shows an opened row at once under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    render(<ChangeList sections={SECTIONS} aria-label="Changes" />);
    await userEvent.click(rowOf(/Score/));
    const running = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number(animation.effect?.getComputedTiming().duration) > 1,
      );
    expect(running).toEqual([]);
    expect(document.querySelector('[data-slot="change-detail"]')).toBeVisible();
  });

  it.each(['light', 'dark'])(
    'passes axe and keeps its words readable, the current row included (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className="bg-card p-2">
          <ChangeSummary
            counts={{ added: 1, removed: 1, changed: 1, renamed: 1 }}
            flags={['Inputs']}
            variant="chips"
            aria-label="Summary"
          />
          <ChangeList
            sections={SECTIONS}
            aria-label="Changes"
            activeId="score"
            defaultExpanded="all"
            onActivate={() => undefined}
            activateLabel="Show on the graph"
          />
        </div>,
      );
      // Let the opened details finish fading in before judging colours.
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished),
      );
      const result = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(result.violations).toEqual([]);
      for (const element of container.querySelectorAll<HTMLElement>(
        '[data-slot="change-kind-badge"], [data-slot="change-summary"] [data-kind], ins, del',
      )) {
        expect(
          ratioAgainst(element, getComputedStyle(element).color),
          `${theme} "${element.textContent}"`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
