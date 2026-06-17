import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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
