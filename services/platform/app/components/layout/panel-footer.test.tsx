import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

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
