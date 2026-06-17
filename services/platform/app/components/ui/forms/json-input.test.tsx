import { Skeletonize } from '@tale/ui/skeleton-context';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { JsonInput } from './json-input';

vi.mock('@tale/ui/theme', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/utils/lazy-component', () => ({
  lazyComponent: () => {
    const Placeholder = () => <div data-testid="json-viewer">JSON viewer</div>;
    Placeholder.preload = vi.fn();
    return Placeholder;
  },
}));

describe('JsonInput', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <JsonInput
          value='{"key": "value"}'
          onChange={vi.fn()}
          label="JSON data"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with error message', async () => {
      const { container } = render(
        <JsonInput
          value=""
          onChange={vi.fn()}
          label="JSON data"
          errorMessage="Invalid JSON"
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('skeleton mode', () => {
    it('masks the editor body while loading', () => {
      render(
        <Skeletonize loading>
          <JsonInput
            value='{"key": "value"}'
            onChange={vi.fn()}
            label="JSON data"
          />
        </Skeletonize>,
      );
      // The real control is laid out invisibly inside an aria-hidden
      // SkeletonBox, so the editor's interactive controls (the toolbar
      // button) are not exposed to the accessibility tree while masked.
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      // The static label stays real.
      expect(screen.getByText('JSON data')).toBeInTheDocument();
    });

    it('renders the real viewer when not loading', () => {
      render(
        <Skeletonize loading={false}>
          <JsonInput
            value='{"key": "value"}'
            onChange={vi.fn()}
            label="JSON data"
          />
        </Skeletonize>,
      );
      expect(screen.getByTestId('json-viewer')).toBeInTheDocument();
    });
  });
});
