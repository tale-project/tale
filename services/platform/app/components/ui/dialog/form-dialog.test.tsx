import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { FormDialog } from './form-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

describe('FormDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <FormDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Create Item"
          description="Fill in the details below."
          onSubmit={vi.fn()}
        >
          <label htmlFor="name">Name</label>
          <input id="name" type="text" />
        </FormDialog>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in submitting state', async () => {
      const { container } = render(
        <FormDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Edit Item"
          onSubmit={vi.fn()}
          isSubmitting={true}
        >
          <label htmlFor="field">Field</label>
          <input id="field" type="text" />
        </FormDialog>,
      );
      await checkAccessibility(container);
    });
  });
});
