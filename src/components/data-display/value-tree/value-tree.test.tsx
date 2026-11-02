import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { ValueMark, ValueMarkKind } from './model';
import { ValueTree } from './value-tree';

const ISSUE = {
  title: 'Fix login',
  labels: ['bug', 'ui'],
  author: { name: 'Ada', id: 7 },
  score: null,
};

function rowNames() {
  return screen
    .getAllByRole('treeitem')
    .map((row) => row.getAttribute('aria-label'));
}

/** user-event's `setup()` installs its own clipboard; spy on that one. */
function spyOnClipboard() {
  return vi.spyOn(navigator.clipboard, 'writeText');
}

describe('ValueTree', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names each row by its key and its value in words', () => {
    render(<ValueTree value={ISSUE} aria-label="Output" />);
    const tree = screen.getByRole('tree', { name: 'Output' });
    expect(tree).toHaveAccessibleDescription(
      'Arrow keys move and open. Type a field name to jump to it.',
    );
    expect(rowNames()).toEqual([
      'title, "Fix login"',
      'labels, a list of 2 items',
      'author, an object with 2 fields',
      'score, empty',
    ]);
    const labels = screen.getByRole('treeitem', { name: /^labels/ });
    expect(labels).toHaveAttribute('aria-expanded', 'false');
    expect(labels).toHaveAttribute('aria-level', '1');
    expect(labels).toHaveAttribute('aria-posinset', '2');
    expect(labels).toHaveAttribute('aria-setsize', '4');
  });

  it('keeps one tab stop and moves it with the arrow keys', async () => {
    const { user } = render(<ValueTree value={ISSUE} aria-label="Output" />);
    const rows = screen.getAllByRole('treeitem');
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1, -1]);
    await user.tab();
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: /^labels/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /^labels/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: '0, "bug"' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: /^labels/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(
      screen.getByRole('treeitem', { name: 'score, empty' }),
    ).toHaveFocus();
    await user.keyboard('a');
    expect(screen.getByRole('treeitem', { name: /^author/ })).toHaveFocus();
  });

  it('opens a container on click when nothing selects', async () => {
    const { user } = render(<ValueTree value={ISSUE} aria-label="Output" />);
    await user.click(screen.getByRole('treeitem', { name: /^author/ }));
    expect(rowNames()).toContain('name, "Ada"');
    expect(rowNames()).toContain('id, 7');
  });

  it('selects with Enter and a click, and marks the selected row', async () => {
    const onSelect = vi.fn();
    const { user, rerender } = render(
      <ValueTree
        value={ISSUE}
        aria-label="Output"
        onSelectPointer={onSelect}
        selectedPointer={null}
      />,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('/title');
    await user.click(screen.getByRole('treeitem', { name: 'score, empty' }));
    expect(onSelect).toHaveBeenLastCalledWith('/score');
    rerender(
      <ValueTree
        value={ISSUE}
        aria-label="Output"
        onSelectPointer={onSelect}
        selectedPointer="/author/name"
      />,
    );
    expect(
      screen.getByRole('treeitem', { name: 'name, "Ada"' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('treeitem', { name: 'score, empty' }),
    ).toHaveAttribute('aria-selected', 'false');
  });

  it('says what a mark means in the row name, never by colour alone', () => {
    render(
      <ValueTree
        value={{ amount: 300, score: 7, kind: 'text' }}
        aria-label="After"
        marks={
          new Map<string, ValueMarkKind | ValueMark>([
            ['/amount', { kind: 'changed', before: 250 }],
            ['/score', 'added'],
            ['/kind', { kind: 'type-changed', before: 3 }],
            ['/missing', 'missing'],
          ])
        }
      />,
    );
    expect(rowNames()).toEqual([
      'Changed from 250: amount, 300',
      'Added: score, 7',
      'Type changed from 3: kind, "text"',
      'missing: missing',
    ]);
  });

  it('shows what the recorder left out as chips, not as values', () => {
    render(
      <ValueTree
        value={{ body: 'Lorem', token: null, items: [1], deep: null }}
        aria-label="Input"
        elided={[
          { pointer: '/body', kind: 'string', dropped: 3412 },
          { pointer: '/items', kind: 'items', dropped: 150 },
          { pointer: '/deep', kind: 'depth', dropped: 900 },
        ]}
        redacted={['/token']}
      />,
    );
    expect(rowNames()).toEqual([
      'body, "Lorem", +3,412 characters not kept',
      'token, Hidden secret',
      'items, a list of 1 item, +150 items not kept',
      'deep, Deeper levels not kept',
    ]);
    const token = screen.getByRole('treeitem', {
      name: 'token, Hidden secret',
    });
    expect(within(token).getByText('Hidden secret')).toBeInTheDocument();
    expect(within(token).queryByText('null')).toBeNull();
  });

  it('says a whole value too large to keep above the tree', () => {
    render(
      <ValueTree
        value={{ a: 1 }}
        aria-label="Output"
        elided={[{ pointer: '', kind: 'items', dropped: 12 }]}
      />,
    );
    expect(screen.getByText('+12 items not kept')).toBeInTheDocument();
  });

  it('cuts long text to one line until it is opened', async () => {
    const long = 'x'.repeat(300);
    const { user } = render(
      <ValueTree value={{ body: long }} aria-label="Input" />,
    );
    const row = screen.getByRole('treeitem', { name: /^body/ });
    expect(row.getAttribute('aria-label')).toBe(`body, "${'x'.repeat(240)}…"`);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(row.getAttribute('aria-label')).toBe(`body, "${long}"`);
    expect(within(row).getByText('Show less')).toBeInTheDocument();
  });

  it('pages a long list behind "Show N more"', async () => {
    const { user } = render(
      <ValueTree
        value={Array.from({ length: 60 }, (_, index) => index)}
        aria-label="Numbers"
        pageSize={25}
      />,
    );
    expect(screen.getAllByRole('treeitem')).toHaveLength(26);
    const more = screen.getByRole('treeitem', { name: 'Show 25 more' });
    await user.click(more);
    expect(screen.getAllByRole('treeitem')).toHaveLength(51);
    expect(screen.getByRole('treeitem', { name: '25, 25' })).toHaveFocus();
  });

  it('copies a value with ⌘C and its path with ⇧⌘C, and says so', async () => {
    const { user } = render(
      <ValueTree
        value={{ issues: [{ title: 'Fix' }] }}
        aria-label="Output"
        defaultExpandDepth={3}
      />,
    );
    const writeText = spyOnClipboard();
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(
      screen.getByRole('treeitem', { name: 'title, "Fix"' }),
    ).toHaveFocus();
    await user.keyboard('{Meta>}c{/Meta}');
    expect(writeText).toHaveBeenLastCalledWith('Fix');
    await user.keyboard('{Control>}{Shift>}C{/Shift}{/Control}');
    expect(writeText).toHaveBeenLastCalledWith('issues[0].title');
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    await user.keyboard('{Home}{Meta>}c{/Meta}');
    expect(writeText).toHaveBeenLastCalledWith(
      JSON.stringify([{ title: 'Fix' }], null, 2),
    );
  });

  it('copies nothing from the keyboard when copying is off', async () => {
    const { user } = render(
      <ValueTree value={{ a: 1 }} aria-label="Output" copyable={false} />,
    );
    const writeText = spyOnClipboard();
    await user.tab();
    await user.keyboard('{Meta>}c{/Meta}');
    expect(writeText).not.toHaveBeenCalled();
    expect(
      screen.getByRole('treeitem').querySelectorAll('button'),
    ).toHaveLength(0);
  });

  it('passes an axe audit with marks, chips and a ghost row', async () => {
    const { container } = render(
      <ValueTree
        value={{ amount: 300, token: null, nested: { a: 1 } }}
        aria-label="Output"
        redacted={['/token']}
        marks={
          new Map<string, ValueMarkKind | ValueMark>([
            ['/amount', { kind: 'changed', before: 250 }],
            ['/nested/b', 'missing'],
          ])
        }
      />,
    );
    await checkAccessibility(container);
  });
});
