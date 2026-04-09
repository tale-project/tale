import { Inbox } from 'lucide-react';
import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DataTableEmptyState } from './data-table-empty-state';

describe('DataTableEmptyState', () => {
  describe('accessibility', () => {
    it('passes axe audit with title only', async () => {
      const { container } = render(
        <DataTableEmptyState title="No items found" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with icon and description', async () => {
      const { container } = render(
        <DataTableEmptyState
          icon={Inbox}
          title="No results"
          description="Try adjusting your search or filters."
        />,
      );
      await checkAccessibility(container);
    });
  });
});
