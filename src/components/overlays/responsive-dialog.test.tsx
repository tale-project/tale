import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from './responsive-dialog';

function setViewport(matches: Record<string, boolean>) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * A dialog opened from state with no `ResponsiveDialogTrigger` — the task
 * board's card → task detail path. The opener holds focus when `open` flips.
 */
function StateOpened({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">Opener</button>
      <ResponsiveDialog open={open} onOpenChange={vi.fn()}>
        <ResponsiveDialogContent closeLabel="Close">
          <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Body text</ResponsiveDialogDescription>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

async function expectFocusReturnsToOpener() {
  const { rerender } = render(<StateOpened open={false} />);
  const opener = screen.getByRole('button', { name: 'Opener' });
  opener.focus();
  rerender(<StateOpened open />);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(opener).not.toHaveFocus();
  rerender(<StateOpened open={false} />);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(opener).toHaveFocus();
}

function Example() {
  return (
    <ResponsiveDialog defaultOpen>
      <ResponsiveDialogTrigger>Open</ResponsiveDialogTrigger>
      <ResponsiveDialogContent closeLabel="Close">
        <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>Body text</ResponsiveDialogDescription>
        <ResponsiveDialogClose>Done</ResponsiveDialogClose>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

describe('ResponsiveDialog', () => {
  describe('desktop variant', () => {
    beforeEach(() => {
      setViewport({
        '(min-width: 768px)': true,
        '(min-width: 1024px)': true,
      });
    });

    it('renders title and description when open', () => {
      render(<Example />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Body text')).toBeInTheDocument();
    });

    it('exposes a close button labelled by `closeLabel`', () => {
      render(<Example />);
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('marks the content as a modal dialog (aria-modal)', () => {
      render(<Example />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('returns focus to the opener when a state-opened dialog closes', async () => {
      await expectFocusReturnsToOpener();
    });

    it('stays open when the pointer is on a portaled date picker', () => {
      const onOpenChange = vi.fn();
      render(
        <ResponsiveDialog open onOpenChange={onOpenChange}>
          <ResponsiveDialogContent closeLabel="Close">
            <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Body text</ResponsiveDialogDescription>
          </ResponsiveDialogContent>
        </ResponsiveDialog>,
      );
      const layer = document.createElement('div');
      layer.setAttribute('data-tale-datepicker-popper', '');
      document.body.append(layer);
      fireEvent.pointerDown(layer);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      layer.remove();
    });
  });

  describe('mobile variant', () => {
    beforeEach(() => {
      setViewport({
        '(min-width: 768px)': false,
        '(min-width: 1024px)': false,
      });
    });

    it('renders the drawer content with title', () => {
      render(<Example />);
      // vaul wraps title in role="dialog" too.
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Body text')).toBeInTheDocument();
    });

    it('marks the drawer content as a modal dialog (aria-modal)', () => {
      render(<Example />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('returns focus to the opener when a state-opened drawer closes', async () => {
      await expectFocusReturnsToOpener();
    });
  });

  describe('accessibility', () => {
    beforeEach(() => {
      setViewport({
        '(min-width: 768px)': true,
        '(min-width: 1024px)': true,
      });
    });

    it('passes axe audit', async () => {
      const { container } = render(<Example />);
      await checkAccessibility(container);
    });
  });
});
