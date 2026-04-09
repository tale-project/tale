import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { AccessDenied } from './access-denied';

describe('AccessDenied', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AccessDenied message="You do not have permission to view this page." />,
      );
      await checkAccessibility(container);
    });
  });
});
