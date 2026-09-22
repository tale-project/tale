import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { PanelFooter } from './panel-footer';

describe('PanelFooter', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <PanelFooter>
          <button>Save</button>
        </PanelFooter>,
      );
      await checkAccessibility(container);
    });
  });
});
