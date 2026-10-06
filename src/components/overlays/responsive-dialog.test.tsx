import { useRef } from 'react';
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
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <button type="button">Opener</button>
      <ResponsiveDialog open={open} onOpenChange={vi.fn()}>
        <ResponsiveDialogContent
          ref={contentRef}
          closeLabel="Close"
          onOpenAutoFocus={(event) => {
            // The task modal starts on its container, including the drawer
            // whose default autofocus is disabled to avoid the soft keyboard.
            event.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
        >
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
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveFocus();
  expect(opener).not.toHaveFocus();
  rerender(<StateOpened open={false} />);
  if (dialog.hasAttribute('data-vaul-drawer')) {
    // Vaul ships CSS animations, but jsdom never emits their completion.
    const animationEnd = new Event('animationend', { bubbles: true });
    Object.defineProperty(animationEnd, 'animationName', {
      value: window.getComputedStyle(dialog).animationName,
    });
    fireEvent(dialog, animationEnd);
  }
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
        '(max-width: 767px)': false,
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

    // Radix parks focus on the panel when its content is swapped out (a
    // task dialog whose loading title gives way to the task); the panel is
    // not a control, so the browser's default ring must not frame it.
    it('draws no focus ring around the panel itself', () => {
      render(<Example />);
      expect(screen.getByRole('dialog')).toHaveClass('outline-none');
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
        '(max-width: 767px)': true,
      });
    });

    it('renders the drawer content with title', () => {
      render(<Example />);
      // vaul wraps title in role="dialog" too.
      expect(screen.getByRole('dialog')).toHaveAttribute('data-vaul-drawer');
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Body text')).toBeInTheDocument();
    });

    it('marks the drawer content as a modal dialog (aria-modal)', () => {
      render(<Example />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('draws no focus ring around the drawer itself', () => {
      render(<Example />);
      expect(screen.getByRole('dialog')).toHaveClass('outline-none');
    });

    it('returns focus to the opener when a state-opened drawer closes', async () => {
      await expectFocusReturnsToOpener();
    });
  });

  describe('accessibility', () => {
    beforeEach(() => {
      setViewport({
        '(max-width: 767px)': false,
      });
    });

    it('passes axe audit', async () => {
      const { container } = render(<Example />);
      await checkAccessibility(container);
    });
  });
});
