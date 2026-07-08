import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { ThreadFileItem } from '../types';
import { CanvasFileTree } from './canvas-file-tree';

function file(path: string, source: ThreadFileItem['source']): ThreadFileItem {
  return {
    path,
    source,
    size: 1024,
    contentType: 'text/plain',
    updatedAt: 0,
  };
}

const FILES: ThreadFileItem[] = [
  file('/user/code/report.md', 'agent_write'),
  file('/user/code/plan.md', 'agent_write'),
  file('/user/uploads/input.pdf', 'user_upload'),
  file('/user/output/chart.png', 'run_output'),
];

describe('CanvasFileTree', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CanvasFileTree
          files={FILES}
          activePath="/user/code/report.md"
          onSelect={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders one directory per non-empty source, in code/uploads/output order', () => {
    render(
      <CanvasFileTree files={FILES} activePath={null} onSelect={vi.fn()} />,
    );
    const dirs = screen
      .getAllByRole('treeitem')
      .filter((el) => el.dataset.dirPath !== undefined)
      .map((el) => el.dataset.dirPath);
    expect(dirs).toEqual(['code', 'uploads', 'output']);
  });

  it('omits directories with no files', () => {
    render(
      <CanvasFileTree
        files={[file('/user/uploads/photo.png', 'user_upload')]}
        activePath={null}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('treeitem', { name: 'uploads/ — Uploaded' }),
    ).toBeDefined();
    expect(
      screen.queryByRole('treeitem', { name: 'code/ — AI files' }),
    ).toBeNull();
  });

  it('lists every file under its source directory, expanded by default', () => {
    render(
      <CanvasFileTree files={FILES} activePath={null} onSelect={vi.fn()} />,
    );
    expect(
      screen.getByRole('treeitem', { name: 'report.md — AI files' }),
    ).toBeDefined();
    expect(
      screen.getByRole('treeitem', { name: 'input.pdf — Uploaded' }),
    ).toBeDefined();
    expect(
      screen.getByRole('treeitem', { name: 'chart.png — Code output' }),
    ).toBeDefined();
  });

  it('collapsing a directory hides its files (chevron toggle)', async () => {
    const { user } = render(
      <CanvasFileTree files={FILES} activePath={null} onSelect={vi.fn()} />,
    );
    const dir = screen.getByRole('treeitem', { name: 'uploads/ — Uploaded' });
    expect(dir).toHaveAttribute('aria-expanded', 'true');
    await user.click(dir);
    expect(dir).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('treeitem', { name: 'input.pdf — Uploaded' }),
    ).toBeNull();
  });

  it('selects a file when its row is clicked', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <CanvasFileTree files={FILES} activePath={null} onSelect={onSelect} />,
    );
    await user.click(
      screen.getByRole('treeitem', { name: 'chart.png — Code output' }),
    );
    expect(onSelect).toHaveBeenCalledWith('/user/output/chart.png');
  });

  it('marks only the active file row selected', () => {
    render(
      <CanvasFileTree
        files={FILES}
        activePath="/user/code/plan.md"
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('treeitem', { name: 'plan.md — AI files' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('treeitem', { name: 'report.md — AI files' }),
    ).toHaveAttribute('aria-selected', 'false');
  });

  it('renders the active-file meta inside its row', () => {
    render(
      <CanvasFileTree
        files={FILES}
        activePath="/user/code/plan.md"
        onSelect={vi.fn()}
        meta="Writing…"
      />,
    );
    expect(screen.getByText('Writing…')).toBeDefined();
  });

  it('renders nothing when there are no files', () => {
    const { container } = render(
      <CanvasFileTree files={[]} activePath={null} onSelect={vi.fn()} />,
    );
    expect(container.querySelector('[role="tree"]')).toBeNull();
  });

  it('moves focus down the rendered rows with ArrowDown', async () => {
    const { user } = render(
      <CanvasFileTree
        files={FILES}
        activePath="/user/code/report.md"
        onSelect={vi.fn()}
      />,
    );
    const active = screen.getByRole('treeitem', {
      name: 'report.md — AI files',
    });
    active.focus();
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('treeitem', { name: 'plan.md — AI files' }),
    ).toHaveFocus();
  });
});
