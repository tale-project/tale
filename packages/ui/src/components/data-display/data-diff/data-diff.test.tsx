import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { diffValues } from '../../../data/value-diff';
import { DataDiff, DataDiffSummary } from './data-diff';

const BEFORE = {
  title: 'Fix login',
  amount: 250,
  draft: 'old',
  labels: 'bug',
  owner: { name: 'Ada', team: 'core' },
};
const AFTER = {
  title: 'Fix login bug',
  amount: 250,
  labels: ['bug', 'ui', 'docs'],
  owner: { name: 'Ada', team: 'web' },
  score: 7,
};

function sentences() {
  const list = screen.getByRole('list', { name: 'Changes' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent ?? item.textContent);
}

describe('DataDiff', () => {
  it('says each change as a sentence, in the order the value is written', () => {
    render(<DataDiff before={BEFORE} after={AFTER} aria-label="Changes" />);
    expect(sentences()).toEqual([
      'title changed from "Fix login" to "Fix login bug"',
      'labels changed from text to list of texts: a list of 3 items',
      'owner.team changed from "core" to "web"',
      'Added score: 7',
      'Removed draft (was "old")',
      '2 unchanged fields',
    ]);
    expect(
      screen.getByText('1 added, 1 removed, 2 changed, 1 changed type'),
    ).toBeInTheDocument();
  });

  it('folds the unchanged fields into one row that opens', async () => {
    const onShowUnchangedChange = vi.fn();
    const { user } = render(
      <DataDiff
        before={BEFORE}
        after={AFTER}
        aria-label="Changes"
        onShowUnchangedChange={onShowUnchangedChange}
      />,
    );
    const toggle = screen.getByRole('button', { name: '2 unchanged fields' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(onShowUnchangedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('amount')).toBeInTheDocument();
    expect(screen.getByText('owner.name')).toBeInTheDocument();
  });

  it('opens a wholly added list to its values', async () => {
    const { user } = render(
      <DataDiff
        before={{ a: 1 }}
        after={{ a: 1, tags: ['x', 'y'] }}
        aria-label="Changes"
      />,
    );
    expect(sentences()[0]).toBe('Added tags: a list of 2 items');
    await user.click(screen.getByRole('button', { name: 'Show value' }));
    expect(screen.getByRole('tree', { name: 'tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide value' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('says "No changes" for equal values and a host sentence when given', () => {
    const { rerender } = render(
      <DataDiff before={{ a: [1] }} after={{ a: [1] }} aria-label="Changes" />,
    );
    expect(screen.getByText('No changes')).toBeInTheDocument();
    rerender(
      <DataDiff
        before={{ a: [1] }}
        after={{ a: [1] }}
        aria-label="Changes"
        emptyMessage="Same as the previous pass"
      />,
    );
    expect(screen.getByText('Same as the previous pass')).toBeInTheDocument();
  });

  it('says when two values share nothing to compare', () => {
    render(<DataDiff before={{ a: 1 }} after={[1, 2]} aria-label="Changes" />);
    expect(
      screen.getByText(
        "They don't share a structure, so there's nothing to compare field by field.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('names a change to the whole value in words, capitalised at the start', () => {
    render(<DataDiff before={250} after={300} aria-label="Changes" />);
    expect(sentences()).toEqual(['The whole value changed from 250 to 300']);
  });

  it('says a withheld place was not compared, never that it changed', () => {
    render(
      <DataDiff
        before={{ token: null, a: 1 }}
        after={{ token: 'x', a: 2 }}
        options={{ unknownAt: ['/token'] }}
        aria-label="Changes"
      />,
    );
    expect(sentences()).toContain(
      "token: not compared, part of it wasn't kept",
    );
  });

  it('compares shapes: fields that appeared, disappeared and changed kind', () => {
    render(
      <DataDiff
        before={{ items: [{ id: 1, name: 'a' }], count: 1 }}
        after={{ items: [{ id: '1' }, { id: '2', size: 3 }], total: 2 }}
        mode="shape"
        aria-label="Changes"
      />,
    );
    expect(sentences()).toEqual([
      'items[].id: a whole number became text',
      'items[].size appeared (a whole number)',
      'items[].name disappeared',
      'total appeared (a whole number)',
      'count disappeared',
    ]);
  });

  it('shows how many changes a long diff left out', () => {
    const before = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`k${index}`, index]),
    );
    const after = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`k${index}`, index + 1]),
    );
    render(
      <DataDiff
        before={before}
        after={after}
        options={{ maxChanges: 10 }}
        aria-label="Changes"
      />,
    );
    expect(screen.getByText('2 more changes')).toBeInTheDocument();
  });

  it('uses a diff computed elsewhere', () => {
    const result = diffValues({ a: 1 }, { a: 2 });
    render(
      <DataDiff before={{}} after={{}} result={result} aria-label="Changes" />,
    );
    expect(sentences()).toEqual(['a changed from 1 to 2']);
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <DataDiff before={BEFORE} after={AFTER} aria-label="Changes" />,
    );
    await checkAccessibility(container);
  });
});

describe('DataDiffSummary', () => {
  it('lists only the kinds that occurred, and "No changes" without any', () => {
    const { rerender } = render(
      <DataDiffSummary
        counts={{
          added: 3,
          removed: 0,
          changed: 1,
          'type-changed': 0,
          reordered: 1,
          unknown: 0,
          unchanged: 9,
        }}
      />,
    );
    expect(
      screen.getByText('3 added, 1 changed, 1 reordered'),
    ).toBeInTheDocument();
    rerender(
      <DataDiffSummary
        counts={{
          added: 0,
          removed: 0,
          changed: 0,
          'type-changed': 0,
          reordered: 0,
          unknown: 0,
          unchanged: 4,
        }}
      />,
    );
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });
});
