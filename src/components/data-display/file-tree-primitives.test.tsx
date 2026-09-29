import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TreeRowButton, treeNavigationKeyDown } from './file-tree-primitives';

// A list-shaped "tree" — rows beside their own action buttons — cannot be a
// WAI-ARIA tree (a tree owns treeitems only, and a treeitem may not contain
// controls). `semantics="list"` renders the same row as a plain button in a
// plain list; the keyboard walk still works because it keys on the row marker.
function ListShaped() {
  const ref = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the list only relays arrow keys to its rows, exactly as the Files tab's list does
    <ul
      ref={ref}
      aria-label="Project files"
      onKeyDown={(event) =>
        treeNavigationKeyDown(event, ref.current, expanded, toggle)
      }
    >
      <li>
        <TreeRowButton
          semantics="list"
          isActive
          depth={0}
          onClick={() => toggle('reports')}
          title="Reports"
          ariaLabel="Reports"
          ariaExpanded={expanded.has('reports')}
          dataDirPath="reports"
        >
          Reports
        </TreeRowButton>
        <button type="button">Delete folder</button>
      </li>
      <li>
        <TreeRowButton
          semantics="list"
          isActive={false}
          depth={1}
          onClick={() => undefined}
          title="Q3.pdf"
          ariaLabel="Q3.pdf"
          dataParentPath="reports"
        >
          Q3.pdf
        </TreeRowButton>
        <button type="button">Preview file</button>
      </li>
    </ul>
  );
}

describe('TreeRowButton semantics="list"', () => {
  it('is a plain button: no treeitem role, aria-current for the active row', async () => {
    const { container } = render(<ListShaped />);
    const active = screen.getByRole('button', { name: 'Reports' });
    expect(active).not.toHaveAttribute('role');
    expect(active).not.toHaveAttribute('aria-selected');
    expect(active).not.toHaveAttribute('aria-level');
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Q3.pdf' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    await checkAccessibility(container);
  });

  it('keeps the arrow-key walk and Right-to-expand', async () => {
    const { user } = render(<ListShaped />);
    const reports = screen.getByRole('button', { name: 'Reports' });
    reports.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Q3.pdf' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(reports).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(reports).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('TreeRowButton default semantics', () => {
  it('stays a WAI-ARIA treeitem', () => {
    render(
      <ul role="tree" aria-label="Files">
        <li role="none">
          <TreeRowButton
            isActive
            depth={0}
            onClick={() => undefined}
            title="SKILL.md"
            ariaLabel="SKILL.md"
          >
            SKILL.md
          </TreeRowButton>
        </li>
      </ul>,
    );
    const row = screen.getByRole('treeitem', { name: 'SKILL.md' });
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).toHaveAttribute('aria-level', '1');
    expect(row).not.toHaveAttribute('aria-current');
  });
});
