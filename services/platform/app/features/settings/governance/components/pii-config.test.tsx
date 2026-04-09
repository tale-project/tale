import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { PiiConfig } from './pii-config';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertPiiConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/queries', () => ({
  usePiiConfig: () => ({
    data: {
      enabled: false,
      config: {
        mode: 'mask',
        enabledPatterns: [],
        customPatterns: [],
      },
    },
    isLoading: false,
  }),
}));

describe('PiiConfig', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<PiiConfig organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});
