import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { JsonViewer } from './json-viewer';

const NESTED = { name: 'test', meta: { tags: ['a', 'b'], owner: { id: 7 } } };

function rowNames() {
  return screen
    .queryAllByRole('treeitem')
    .map((row) => row.getAttribute('aria-label'));
}

describe('JsonViewer', () => {
  // Plain JSON values are honest too (a run whose automation maps no
  // `output` shows a null output), so they render as plain JSON text and
  // never as an empty tree.
  describe('non-container values', () => {
    it('renders null as JSON text, never through the tree', () => {
      render(<JsonViewer data={null} />);
      expect(screen.getByText('null')).toBeInTheDocument();
      expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    });

    it('renders a bare string in its JSON form', () => {
      render(<JsonViewer data="hello" />);
      expect(screen.getByText('"hello"')).toBeInTheDocument();
      expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    });

    it('renders numbers and booleans as text', () => {
      const { unmount } = render(<JsonViewer data={42} />);
      expect(screen.getByText('42')).toBeInTheDocument();
      unmount();
      render(<JsonViewer data={false} />);
      expect(screen.getByText('false')).toBeInTheDocument();
    });

    it('a JSON string that parses to a scalar renders as that scalar', () => {
      render(<JsonViewer data='"quoted"' />);
      expect(screen.getByText('"quoted"')).toBeInTheDocument();
      expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    });

    it('renders undefined as text instead of an empty tree', () => {
      render(<JsonViewer data={undefined} />);
      expect(screen.getByText('undefined')).toBeInTheDocument();
      expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    });

    it('still renders objects and arrays as a value tree', () => {
      const { unmount } = render(<JsonViewer data={{ a: 1 }} />);
      expect(screen.getByRole('tree', { name: 'Value' })).toBeInTheDocument();
      expect(rowNames()).toEqual(['a, 1']);
      unmount();
      render(<JsonViewer data={[1, 2]} />);
      expect(rowNames()).toEqual(['0, 1', '1, 2']);
    });

    it('passes axe audit with null data', async () => {
      const { container } = render(<JsonViewer data={null} />);
      await checkAccessibility(container);
    });
  });

  describe('collapsed', () => {
    it('opens every level by default', () => {
      render(<JsonViewer data={NESTED} />);
      expect(rowNames()).toEqual([
        'name, "test"',
        'meta, an object with 2 fields',
        'tags, a list of 2 items',
        '0, "a"',
        '1, "b"',
        'owner, an object with 1 field',
        'id, 7',
      ]);
    });

    it('shows the top level with its containers closed when true', () => {
      render(<JsonViewer data={NESTED} collapsed />);
      expect(rowNames()).toEqual([
        'name, "test"',
        'meta, an object with 2 fields',
      ]);
    });

    it('opens that many levels when a number', () => {
      render(<JsonViewer data={NESTED} collapsed={2} />);
      expect(rowNames()).toEqual([
        'name, "test"',
        'meta, an object with 2 fields',
        'tags, a list of 2 items',
        'owner, an object with 1 field',
      ]);
    });

    it('reads JSON text into the tree', () => {
      render(<JsonViewer data='{"parsed": "from string"}' collapsed />);
      expect(rowNames()).toEqual(['parsed, "from string"']);
    });
  });

  describe('clipboard', () => {
    it('copies the whole value as JSON with its indent', async () => {
      const { user } = render(
        <JsonViewer data={{ key: 'value' }} enableClipboard indentWidth={4} />,
      );
      const writeText = vi.spyOn(navigator.clipboard, 'writeText');
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify({ key: 'value' }, null, 4),
      );
    });

    it('has no copy controls without enableClipboard', () => {
      render(<JsonViewer data={{ key: 'value' }} />);
      expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
      expect(
        document.querySelectorAll('[role="treeitem"] button'),
      ).toHaveLength(0);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <JsonViewer data={{ name: 'test', value: 42 }} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with clipboard enabled', async () => {
      const { container } = render(
        <JsonViewer data={{ key: 'value' }} enableClipboard />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with string data', async () => {
      const { container } = render(
        <JsonViewer data='{"key": "value"}' collapsed />,
      );
      await checkAccessibility(container);
    });
  });
});
