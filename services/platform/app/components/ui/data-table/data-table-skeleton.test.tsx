import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DataTableSkeleton } from './data-table-skeleton';

describe('DataTableSkeleton', () => {
  describe('accessibility', () => {
    it('passes axe audit with basic columns', async () => {
      const { container } = render(
        <DataTableSkeleton
          rows={3}
          columns={[
            { header: 'Name', size: 200 },
            { header: 'Email', size: 250 },
            { header: 'Status', size: 100 },
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with sticky layout', async () => {
      const { container } = render(
        <DataTableSkeleton
          rows={5}
          columns={[
            { header: 'Name', size: 200, hasAvatar: true },
            { header: 'Role', size: 150 },
            { header: 'Status', size: 100 },
          ]}
          stickyLayout
          searchPlaceholder="Search..."
        />,
      );
      await checkAccessibility(container);
    });
  });
});
