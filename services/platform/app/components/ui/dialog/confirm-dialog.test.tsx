import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ConfirmDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Confirm Action"
          description="Are you sure you want to proceed?"
          onConfirm={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with destructive variant', async () => {
      const { container } = render(
        <ConfirmDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Destructive Confirm"
          description="This action is destructive."
          onConfirm={vi.fn()}
          variant="destructive"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in loading state', async () => {
      const { container } = render(
        <ConfirmDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Loading Confirm"
          description="Processing..."
          onConfirm={vi.fn()}
          isLoading={true}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
