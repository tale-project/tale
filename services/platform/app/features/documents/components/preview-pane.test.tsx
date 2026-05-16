// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { PreviewPane } from './preview-pane';

describe('PreviewPane', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <PreviewPane>
          <p>Preview content</p>
        </PreviewPane>,
      );
      await checkAccessibility(container);
    });
  });
});
