import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Input } from './input';
import { Label } from './label';

describe('Label', () => {
  describe('accessibility', () => {
    it('passes axe audit when associated with a control', async () => {
      const { container } = render(
        <>
          <Label htmlFor="name">Name</Label>
          <Input id="name" />
        </>,
      );
      await checkAccessibility(container);
    });
  });
});
