import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { FormDialog } from './form-dialog';

vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org_test' }),
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

  describe('footerStart', () => {
    it('puts what it is given at the start of the footer, before Cancel and the submit button', () => {
      render(
        <FormDialog
          open
          onOpenChange={vi.fn()}
          title="Import proxies"
          submitText="Import proxies"
          footerStart={<button type="button">Choose file</button>}
          onSubmit={vi.fn()}
        >
          <input aria-label="Proxies" />
        </FormDialog>,
      );
      const choose = screen.getByRole('button', { name: 'Choose file' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      const submit = screen.getByRole('button', { name: 'Import proxies' });
      expect(choose.closest('form')).toContainElement(submit);
      expect(
        choose.compareDocumentPosition(cancel) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        cancel.compareDocumentPosition(submit) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('gives way to a custom footer', () => {
      render(
        <FormDialog
          open
          onOpenChange={vi.fn()}
          title="Import proxies"
          footerStart={<button type="button">Choose file</button>}
          customFooter={<button type="button">Done</button>}
        >
          <input aria-label="Proxies" />
        </FormDialog>,
      );
      expect(
        screen.queryByRole('button', { name: 'Choose file' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });
  });

  describe('stickyFooter', () => {
    const fields = (
      <>
        <label htmlFor="first">First</label>
        <input id="first" type="text" />
        <label htmlFor="second">Second</label>
        <input id="second" type="text" />
      </>
    );

    /** The nearest ancestor of `element` (inside `root`) that scrolls on its own. */
    function scroller(element: HTMLElement, root: HTMLElement) {
      for (
        let node = element.parentElement;
        node !== null && node !== root;
        node = node.parentElement
      ) {
        if (node.className.includes('overflow-y-auto')) return node;
      }
      return null;
    }

    it('puts the fields in a box that scrolls and the actions outside it, still inside the form', () => {
      render(
        <FormDialog
          open
          onOpenChange={vi.fn()}
          title="Add secret"
          submitText="Add secret"
          stickyFooter
          onSubmit={vi.fn()}
        >
          {fields}
        </FormDialog>,
      );
      const submit = screen.getByRole('button', { name: 'Add secret' });
      const form = submit.closest('form');
      if (form === null) throw new Error('no form rendered');
      const box = scroller(screen.getByLabelText('First'), form);
      expect(box).not.toBeNull();
      expect(box).not.toContainElement(submit);
      expect(box).not.toContainElement(
        screen.getByRole('button', { name: 'Cancel' }),
      );
      // Enter in a field submits as it does anywhere: the buttons are the form's.
      expect(form).toContainElement(submit);
    });

    it('leaves the scrolling of the dialog to the box, not to the dialog body', () => {
      render(
        <FormDialog
          open
          onOpenChange={vi.fn()}
          title="Add secret"
          stickyFooter
          onSubmit={vi.fn()}
        >
          {fields}
        </FormDialog>,
      );
      const body = screen.getByRole('dialog').querySelector('[tabindex="-1"]');
      expect(body).toHaveClass('overflow-y-hidden');
    });

    it('does nothing unless asked: the fields and the actions scroll together', () => {
      render(
        <FormDialog open onOpenChange={vi.fn()} title="Add secret">
          {fields}
        </FormDialog>,
      );
      const form = screen
        .getByRole('button', { name: /save/i })
        .closest('form');
      if (form === null) throw new Error('no form rendered');
      expect(scroller(screen.getByLabelText('First'), form)).toBeNull();
      const body = screen.getByRole('dialog').querySelector('[tabindex="-1"]');
      expect(body).not.toHaveClass('overflow-y-hidden');
    });

    it('submits with Enter in a field', async () => {
      const onSubmit = vi.fn();
      const { user } = render(
        <FormDialog
          open
          onOpenChange={vi.fn()}
          title="Add secret"
          stickyFooter
          onSubmit={onSubmit}
        >
          {fields}
        </FormDialog>,
      );
      await user.type(screen.getByLabelText('First'), 'x{Enter}');
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('passes axe audit', async () => {
      const { container } = render(
        <FormDialog
          open
          onOpenChange={vi.fn()}
          title="Add secret"
          stickyFooter
          onSubmit={vi.fn()}
        >
          {fields}
        </FormDialog>,
      );
      await checkAccessibility(container);
    });
  });

  describe('initialFocusRef', () => {
    function Form({ named }: { named: boolean }) {
      const title = useRef<HTMLInputElement>(null);
      return (
        <FormDialog
          open
          onOpenChange={vi.fn()}
          title="Add item"
          onSubmit={vi.fn()}
          initialFocusRef={named ? title : undefined}
        >
          <label>
            Code
            <input />
          </label>
          <label>
            Title
            <input ref={title} />
          </label>
        </FormDialog>
      );
    }

    it('opens on the field it is given', async () => {
      render(<Form named />);
      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
      });
    });

    it('opens on the first field when it is given none', async () => {
      render(<Form named={false} />);
      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: 'Code' })).toHaveFocus();
      });
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
