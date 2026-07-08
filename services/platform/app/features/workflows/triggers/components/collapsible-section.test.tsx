// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Clock } from 'lucide-react';
import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { CollapsibleSection } from './collapsible-section';

describe('CollapsibleSection', () => {
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
