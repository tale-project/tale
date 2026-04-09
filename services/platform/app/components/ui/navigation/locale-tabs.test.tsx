import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { LocaleTabs } from './locale-tabs';

describe('LocaleTabs', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <LocaleTabs
          tabs={[
            { locale: 'en', isDefault: true },
            { locale: 'fr', isDefault: false },
          ]}
          activeLocale={null}
          onLocaleChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with non-default locale active', async () => {
      const { container } = render(
        <LocaleTabs
          tabs={[
            { locale: 'en', isDefault: true },
            { locale: 'fr', isDefault: false },
          ]}
          activeLocale="fr"
          onLocaleChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
