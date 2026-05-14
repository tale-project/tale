import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  describe('discard confirm on dirty close', () => {
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    });

    afterEach(() => {
      confirmSpy.mockRestore();
    });

    it('prompts when dirty + confirmDiscardOnDirty and the user cancels', () => {
      const onOpenChange = vi.fn();
      render(
        <FormDialog
          open={true}
          onOpenChange={onOpenChange}
          title="Edit Item"
          isDirty={true}
          confirmDiscardOnDirty
          onSubmit={vi.fn()}
        >
          <input aria-label="field" type="text" />
        </FormDialog>,
      );
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape',
      });
      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('does not prompt when confirmDiscardOnDirty is omitted, even if dirty', () => {
      const onOpenChange = vi.fn();
      render(
        <FormDialog
          open={true}
          onOpenChange={onOpenChange}
          title="Read-only Dialog"
          isDirty={true}
          onSubmit={vi.fn()}
        >
          <input aria-label="field" type="text" />
        </FormDialog>,
      );
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape',
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not prompt when not dirty', () => {
      const onOpenChange = vi.fn();
      render(
        <FormDialog
          open={true}
          onOpenChange={onOpenChange}
          title="Pristine Dialog"
          isDirty={false}
          confirmDiscardOnDirty
          onSubmit={vi.fn()}
        >
          <input aria-label="field" type="text" />
        </FormDialog>,
      );
      const cancel = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancel);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
