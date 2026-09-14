import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { TaleLogo } from './tale-logo';

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ logoUrl: null }),
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => '',
}));

describe('TaleLogo', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<TaleLogo />);
      await checkAccessibility(container);
    });
  });
});
