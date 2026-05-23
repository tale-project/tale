import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { Description } from './description';

describe('Description', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Description>This is a description</Description>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with muted disabled', async () => {
      const { container } = render(
        <Description muted={false}>This is a description</Description>,
      );
      await checkAccessibility(container);
    });
  });
});
