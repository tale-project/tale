import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { TaleLogoText } from './tale-logo-text';

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ textLogo: null, logoUrl: null }),
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => '',
}));

describe('TaleLogoText', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<TaleLogoText />);
      await checkAccessibility(container);
    });

    it('passes axe audit with text logo', async () => {
      vi.mocked(
        await import('@/app/components/branding/branding-provider'),
      ).useBrandingContext = () =>
        // @ts-expect-error -- partial mock for test
        ({ textLogo: 'MyBrand', logoUrl: null });

      const { container } = render(<TaleLogoText />);
      await checkAccessibility(container);
    });
  });
});
