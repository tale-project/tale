import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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

  describe('submit', () => {
    // Regression: the dialog's form has no action, so a submit whose default
    // survives navigates the page — the browser's "Leave site? Changes you made
    // may not be saved." lands on top of the save that is still running. The
    // dialog prevents it for every caller instead of trusting each one to.
    it('prevents the native submission and still calls the handler', () => {
      const onSubmit = vi.fn();
      render(
        <FormDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Edit Item"
          isDirty
          onSubmit={onSubmit}
        >
          <input aria-label="field" type="text" />
        </FormDialog>,
      );
      const submit = screen.getByRole('button', { name: /save/i });
      // `fireEvent.click` on a submit button dispatches the form's submit
      // event; `defaultPrevented` is what the browser reads to decide whether
      // to navigate.
      const form = submit.closest('form');
      if (form === null) throw new Error('no form rendered');
      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it('prevents the native submission with no handler at all', () => {
      render(
        <FormDialog open={true} onOpenChange={vi.fn()} title="No handler">
          <input aria-label="field" type="text" />
        </FormDialog>,
      );
      const form = screen
        .getByRole('button', { name: /save/i })
        .closest('form');
      if (form === null) throw new Error('no form rendered');
      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });
});
