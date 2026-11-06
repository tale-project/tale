import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Form } from './form';

describe('Form', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Form aria-label="Test form">
          <label htmlFor="name">Name</label>
          <input id="name" type="text" />
        </Form>,
      );
      await checkAccessibility(container);
    });
  });
});
