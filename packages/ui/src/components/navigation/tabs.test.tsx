import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Tabs } from './tabs';

describe('Tabs', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Tabs
          defaultValue="tab1"
          items={[
            {
              value: 'tab1',
              label: 'First Tab',
              content: <p>First content</p>,
            },
            {
              value: 'tab2',
              label: 'Second Tab',
              content: <p>Second content</p>,
            },
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with disabled tab', async () => {
      const { container } = render(
        <Tabs
          defaultValue="tab1"
          items={[
            { value: 'tab1', label: 'Active', content: <p>Active content</p> },
            { value: 'tab2', label: 'Disabled', disabled: true },
          ]}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
