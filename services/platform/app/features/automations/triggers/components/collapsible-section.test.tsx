// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { Clock } from 'lucide-react';
import { afterEach, describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CollapsibleSection } from './collapsible-section';

describe('CollapsibleSection', () => {
  afterEach(cleanup);

  describe('accessibility', () => {
    it('passes axe audit when collapsed', async () => {
      const { container } = render(
        <CollapsibleSection id="test-section" icon={Clock} title="Schedules">
          <p>Section content</p>
        </CollapsibleSection>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when expanded', async () => {
      const { container } = render(
        <CollapsibleSection
          id="test-section"
          icon={Clock}
          title="Schedules"
          defaultOpen
        >
          <p>Section content</p>
        </CollapsibleSection>,
      );
      await checkAccessibility(container);
    });
  });
});
