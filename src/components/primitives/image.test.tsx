import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Image } from './image';

const SAMPLE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23ccc'/%3E%3C/svg%3E";

describe('Image', () => {
  describe('accessibility', () => {
    it('passes axe audit with descriptive alt text', async () => {
      const { container } = render(<Image src={SAMPLE} alt="Company logo" />);
      await checkAccessibility(container);
    });

    it('passes axe audit for a decorative image (empty alt)', async () => {
      const { container } = render(<Image src={SAMPLE} alt="" />);
      await checkAccessibility(container);
    });
  });
});
