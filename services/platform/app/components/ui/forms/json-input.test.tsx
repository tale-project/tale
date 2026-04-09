import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { JsonInput } from './json-input';

vi.mock('@/app/components/theme/theme-provider', () => ({
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
});
