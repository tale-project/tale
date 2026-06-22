import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Section } from './section';

describe('Section', () => {
  describe('accessibility', () => {
    it('passes axe audit (default tone)', async () => {
      const { container } = render(
        <Section>
          <p>Default section content</p>
        </Section>,
      );
      await checkAccessibility(container);
    });

    // The inverse tone paints accent-fg on accent-base; verify the pairing
    // carries no contrast violation.
    it('passes axe audit (inverse tone)', async () => {
      const { container } = render(
        <Section tone="inverse">
          <p>Inverse section content</p>
        </Section>,
      );
      await checkAccessibility(container);
    });
  });
});
