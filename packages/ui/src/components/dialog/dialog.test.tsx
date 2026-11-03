import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createRef, useRef, type ReactNode, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Select } from '../forms/select';
import { Dialog } from './dialog';

describe('Dialog', () => {
  describe('back navigation', () => {
    it('renders a back control (labelled) that calls onBack, in every header variant', () => {
      // Consistent regardless of headerActions / icon presence — the back
      // control is a first-class affordance, not a layout side-effect.
      for (const extra of [
        {},
        { headerActions: <button>Act</button> },
        { icon: <span data-testid="ic" /> },
      ]) {
        const onBack = vi.fn();
        const { unmount } = render(
          <Dialog
            open
            onOpenChange={vi.fn()}
            title="Detail"
            description="d"
            onBack={onBack}
            backLabel="Go back"
            {...extra}
          >
            <p>Content</p>
          </Dialog>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
        expect(onBack).toHaveBeenCalledTimes(1);
        unmount();
      }
    });

    it('places header actions and close on the same row', () => {
      render(
        <Dialog
          open
          onOpenChange={vi.fn()}
          title="Item"
          headerActions={<button type="button">Edit</button>}
        >
          <p>Body</p>
        </Dialog>,
      );
      const edit = screen.getByRole('button', { name: 'Edit' });
      const close = screen.getByRole('button', { name: 'Close' });
      expect(edit.parentElement).toBe(close.parentElement);
    });

    it('disables the back control while backDisabled holds, and only then', () => {
      // A sub-view saving disables its Cancel; its back control has to wait
      // the same way, or stepping back drops the input the save was sent from.
      const onBack = vi.fn();
      const dialog = (backDisabled?: boolean) => (
        <Dialog
          open
          onOpenChange={vi.fn()}
          title="Detail"
          onBack={onBack}
          backLabel="Go back"
          backDisabled={backDisabled}
        >
          <p>Content</p>
        </Dialog>
      );
      const { rerender } = render(dialog(true));
      const back = screen.getByRole('button', { name: 'Go back' });
      expect(back).toBeDisabled();
      fireEvent.click(back);
      expect(onBack).not.toHaveBeenCalled();

      rerender(dialog());
      expect(back).toBeEnabled();
      fireEvent.click(back);
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('renders no back control when onBack is absent', () => {
      render(
        <Dialog open onOpenChange={vi.fn()} title="Detail" description="d">
          <p>Content</p>
        </Dialog>,
      );
      expect(
        screen.queryByRole('button', { name: 'Go back' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('header actions', () => {
    it('places header actions and close on the same row', () => {
      render(
        <Dialog
          open
          onOpenChange={vi.fn()}
          title="Item"
          headerActions={<button type="button">Edit</button>}
        >
          <p>Body</p>
        </Dialog>,
      );
      const edit = screen.getByRole('button', { name: 'Edit' });
      const close = screen.getByRole('button', { name: 'Close' });
      expect(edit.parentElement).toBe(close.parentElement);
    });

    it('does not land focus on header actions when openAutoFocus is container', async () => {
      render(
        <Dialog
          open
          onOpenChange={vi.fn()}
          title="Item"
          headerActions={<button type="button">Edit</button>}
          openAutoFocus="container"
        >
          <p>Body</p>
        </Dialog>,
      );
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Edit' })).not.toHaveFocus();
        expect(screen.getByRole('button', { name: 'Close' })).not.toHaveFocus();
      });
    });

    it('opens a form on its first field, never on Close', async () => {
      render(
        <Dialog open onOpenChange={vi.fn()} title="Add contact">
          <label>
            Name
            <input />
          </label>
          <label>
            Email
            <input type="email" />
          </label>
        </Dialog>,
      );
      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
      });
      expect(screen.getByRole('button', { name: 'Close' })).not.toHaveFocus();
    });

    describe('initialFocusRef', () => {
      /** A form that begins with a Radix `Select`, as a record form does. */
      function TypeThenTitle({
        given,
        children,
      }: {
        given?: RefObject<HTMLElement | null>;
        children?: ReactNode;
      }) {
        return (
          <Dialog
            open
            onOpenChange={vi.fn()}
            title="Add secret"
            initialFocusRef={given}
          >
            <form>
              <Select
                label="Type"
                defaultValue="credentials"
                options={[
                  { value: 'credentials', label: 'Credentials' },
                  { value: 'note', label: 'Note' },
                ]}
              />
              {children}
            </form>
          </Dialog>
        );
      }

      function GivenField() {
        const title = useRef<HTMLInputElement>(null);
        return (
          <TypeThenTitle given={title}>
            <label>
              Notes
              <input />
            </label>
            <label>
              Title
              <input ref={title} />
            </label>
          </TypeThenTitle>
        );
      }

      it('opens on the field it is given, whatever comes before it in the form', async () => {
        render(<GivenField />);
        await waitFor(() => {
          expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
        });
      });

      it('opens on the first field while the element it names is not there', async () => {
        const nothing = createRef<HTMLElement>();
        render(
          <Dialog
            open
            onOpenChange={vi.fn()}
            title="Add contact"
            initialFocusRef={nothing}
          >
            <label>
              Name
              <input />
            </label>
          </Dialog>,
        );
        await waitFor(() => {
          expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
        });
      });

      it('keeps the keyboard down on a touch screen, as the default does', async () => {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) =>
          ({
            matches: query === '(pointer: coarse)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
          }) as unknown as MediaQueryList) as typeof window.matchMedia;
        try {
          render(<GivenField />);
          await waitFor(() => {
            expect(screen.getByRole('dialog')).toHaveFocus();
          });
          expect(
            screen.getByRole('textbox', { name: 'Title' }),
          ).not.toHaveFocus();
        } finally {
          window.matchMedia = original;
        }
      });

      it('yields to openAutoFocus="container"', async () => {
        const title = createRef<HTMLInputElement>();
        render(
          <Dialog
            open
            onOpenChange={vi.fn()}
            title="Item"
            openAutoFocus="container"
            initialFocusRef={title}
          >
            <input aria-label="Title" ref={title} />
          </Dialog>,
        );
        await waitFor(() => {
          expect(
            screen.getByRole('textbox', { name: 'Title' }),
          ).not.toHaveFocus();
        });
      });
    });

    it('skips a file input and lands on the dialog when nothing else is typeable', async () => {
      render(
        <Dialog open onOpenChange={vi.fn()} title="Upload contacts">
          <input type="file" aria-label="File" />
          <p>Drop a spreadsheet here.</p>
        </Dialog>,
      );
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toHaveFocus();
      });
    });

    it('opens a dialog without fields on the dialog itself', async () => {
      render(
        <Dialog open onOpenChange={vi.fn()} title="Delete project">
          <p>This cannot be undone.</p>
        </Dialog>,
      );
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toHaveFocus();
      });
      expect(screen.getByRole('button', { name: 'Close' })).not.toHaveFocus();
    });

    it('top-aligns end-placed actions with the title when a subtitle is present', () => {
      render(
        <Dialog
          open
          onOpenChange={vi.fn()}
          title="Example docs"
          description="docs.example.com"
          headerActions={<button type="button">Edit</button>}
        >
          <p>Body</p>
        </Dialog>,
      );
      const title = screen.getByRole('heading', { name: 'Example docs' });
      const header = title.closest('.justify-between');
      expect(header).toHaveClass('items-start');
      expect(header).not.toHaveClass('items-center');
    });

    it('places inline header actions beside the title, close on the far right', () => {
      render(
        <Dialog
          open
          onOpenChange={vi.fn()}
          title="Ada Lovelace"
          description="ada.lovelace@example.com"
          headerActions={<button type="button">Edit</button>}
          headerActionsPlacement="inline"
        >
          <p>Body</p>
        </Dialog>,
      );
      const title = screen.getByRole('heading', { name: 'Ada Lovelace' });
      const edit = screen.getByRole('button', { name: 'Edit' });
      const close = screen.getByRole('button', { name: 'Close' });
      expect(title.parentElement).toContainElement(edit);
      expect(edit.parentElement).not.toBe(close.parentElement);
    });
  });

  describe('body region', () => {
    it('omits the scroll body when there is no children content', () => {
      render(
        <Dialog
          open
          onOpenChange={vi.fn()}
          title="Archive project"
          description="Hide this project from members."
          footer={<button type="button">Archive project</button>}
        />,
      );
      expect(
        document.querySelector('.flex-1.overflow-y-auto'),
      ).not.toBeInTheDocument();
    });

    it('renders the scroll body when children are provided', () => {
      render(
        <Dialog open onOpenChange={vi.fn()} title="Edit profile">
          <p>Form fields</p>
        </Dialog>,
      );
      expect(screen.getByText('Form fields')).toBeInTheDocument();
      expect(
        document.querySelector('.flex-1.overflow-y-auto'),
      ).toBeInTheDocument();
    });

    it('caps the shell so the body is the scrollport', () => {
      render(
        <Dialog open onOpenChange={vi.fn()} title="Edit profile">
          <p>Form fields</p>
        </Dialog>,
      );
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toMatch(/\boverflow-hidden\b/);
      expect(dialog.className).toMatch(/\bmin-h-0\b/);
    });
  });

  describe('accessibility', () => {
    it('marks the content as a modal dialog (aria-modal)', () => {
      render(
        <Dialog open onOpenChange={vi.fn()} title="Test Dialog">
          <p>Content</p>
        </Dialog>,
      );
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('passes axe audit when open', async () => {
      const { container } = render(
        <Dialog
          open={true}
          onOpenChange={vi.fn()}
          title="Test Dialog"
          description="A test dialog description"
        >
          <p>Dialog content</p>
        </Dialog>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with footer', async () => {
      const { container } = render(
        <Dialog
          open={true}
          onOpenChange={vi.fn()}
          title="Dialog with Footer"
          description="Description"
          footer={<button>Save</button>}
        >
          <p>Content</p>
        </Dialog>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with custom header', async () => {
      const { container } = render(
        <Dialog
          open={true}
          onOpenChange={vi.fn()}
          title="Hidden Title"
          customHeader={<div>Custom Header</div>}
        >
          <p>Content</p>
        </Dialog>,
      );
      await checkAccessibility(container);
    });
  });
});
