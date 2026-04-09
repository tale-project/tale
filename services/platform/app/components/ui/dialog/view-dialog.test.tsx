import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ViewDialog } from './view-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

describe('ViewDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ViewDialog
          open={true}
          onOpenChange={vi.fn()}
          title="View Details"
          description="Detailed information below."
        >
          <p>Read-only content</p>
        </ViewDialog>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with header actions', async () => {
      const { container } = render(
        <ViewDialog
          open={true}
          onOpenChange={vi.fn()}
          title="View Item"
          headerActions={<button>Edit</button>}
        >
          <p>Item details</p>
        </ViewDialog>,
      );
      await checkAccessibility(container);
    });
  });
});
