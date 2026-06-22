import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Container } from './container';

describe('Container', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Container>
          <p>Content</p>
        </Container>,
      );
      await checkAccessibility(container);
    });
  });
});
