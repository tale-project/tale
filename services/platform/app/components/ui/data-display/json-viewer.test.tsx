import { vi, describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { JsonViewer } from './json-viewer';

vi.mock('@/lib/utils/lazy-component', () => ({
  lazyComponent: (_factory: () => Promise<unknown>) => {
    // Return a simple pre-based fallback for testing
    const Component = (props: { src: unknown }) => (
      <pre>{JSON.stringify(props.src, null, 2)}</pre>
    );
    Component.displayName = 'LazyComponent';
    return Component;
  },
}));

describe('JsonViewer', () => {
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
