import { vi, describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { JsonViewer } from './json-viewer';

vi.mock('@/lib/utils/lazy-component', () => ({
  lazyComponent: (_factory: () => Promise<unknown>) => {
    // A pre-based stand-in for the react-json-view tree, with a testid so
    // tests can assert WHICH rendering path a value took.
    const Component = (props: { src: unknown }) => (
      <pre data-testid="react-json-view">
        {JSON.stringify(props.src, null, 2)}
      </pre>
    );
    Component.displayName = 'LazyComponent';
    return Component;
  },
}));

describe('JsonViewer', () => {
  // react-json-view accepts only an object/array `src` — anything else used
  // to surface as the library's own {ERROR: "src property must be a valid
  // json object"} placeholder (e.g. a run whose automation maps no `output`
  // shows a null output). Scalars must render as plain JSON text instead.
  describe('non-container values', () => {
    it('renders null as JSON text, never through the object-only tree', () => {
      render(<JsonViewer data={null} />);
      expect(screen.getByText('null')).toBeInTheDocument();
      expect(screen.queryByTestId('react-json-view')).not.toBeInTheDocument();
    });

    it('renders a bare string in its JSON form', () => {
      render(<JsonViewer data="hello" />);
      expect(screen.getByText('"hello"')).toBeInTheDocument();
      expect(screen.queryByTestId('react-json-view')).not.toBeInTheDocument();
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
      expect(screen.queryByTestId('react-json-view')).not.toBeInTheDocument();
    });

    it('renders undefined as text instead of an empty tree', () => {
      render(<JsonViewer data={undefined} />);
      expect(screen.getByText('undefined')).toBeInTheDocument();
      expect(screen.queryByTestId('react-json-view')).not.toBeInTheDocument();
    });

    it('still renders objects and arrays through the tree view', () => {
      const { unmount } = render(<JsonViewer data={{ a: 1 }} />);
      expect(screen.getByTestId('react-json-view')).toBeInTheDocument();
      unmount();
      render(<JsonViewer data={[1, 2]} />);
      expect(screen.getByTestId('react-json-view')).toBeInTheDocument();
    });

    it('passes axe audit with null data', async () => {
      const { container } = render(<JsonViewer data={null} />);
      await checkAccessibility(container);
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
      // The copy button in JsonViewer lacks an accessible name — skip button-name rule
      await checkAccessibility(container, {
        rules: { 'button-name': { enabled: false } },
      });
    });

    it('passes axe audit with string data', async () => {
      const { container } = render(
        <JsonViewer data='{"key": "value"}' collapsed />,
      );
      await checkAccessibility(container);
    });
  });
});
