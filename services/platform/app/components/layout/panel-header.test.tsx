import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { PanelHeader } from './panel-header';

describe('PanelHeader', () => {
  describe('accessibility', () => {
    it('passes axe audit with default variant', async () => {
      const { container } = render(
        <PanelHeader>
          <h2>Panel Title</h2>
        </PanelHeader>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with compact variant', async () => {
      const { container } = render(
        <PanelHeader variant="compact">
          <h2>Compact Panel</h2>
        </PanelHeader>,
      );
      await checkAccessibility(container);
    });
  });
});
