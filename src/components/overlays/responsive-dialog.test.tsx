import type { i18n as I18n } from 'i18next';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

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
function StateOpened({
  open,
  preventCloseAutoFocus,
}: {
  open: boolean;
  preventCloseAutoFocus?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <button type="button">Opener</button>
      <ResponsiveDialog open={open} onOpenChange={vi.fn()}>
        <ResponsiveDialogContent
          ref={contentRef}
          closeLabel="Close"
          {...(preventCloseAutoFocus !== undefined && {
            preventCloseAutoFocus,
          })}
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

/** A dialog with chrome actions beside Close, as the task dialog has. */
function WithHeaderActions({
  hideClose,
  onOpenChange = vi.fn(),
}: {
  hideClose?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <ResponsiveDialog open onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        {...(hideClose !== undefined && { hideClose })}
        headerActions={
          <a href="/tasks/1" aria-label="Open as page">
            Open
          </a>
        }
      >
        <ResponsiveDialogTitle>
          Review the launch checklist
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>Task details</ResponsiveDialogDescription>
        <button type="button">Inside</button>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function expectFollows(later: Element, earlier: Element) {
  expect(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

/** Header actions and Close share one cluster, after the content, with
 *  Close last. */
function expectClusterOrder() {
  const dialog = screen.getByRole('dialog');
  const action = within(dialog).getByRole('link', { name: 'Open as page' });
  const close = within(dialog).getByRole('button', { name: 'Close' });
  expect(action.parentElement).toBe(close.parentElement);
  expectFollows(close, action);
  expectFollows(action, within(dialog).getByRole('button', { name: 'Inside' }));
  return { action, close };
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

    it('names the close control from the shared catalog by default', () => {
      render(<WithHeaderActions />);
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('names the default close control in the reader’s language', async () => {
      // The i18n instance is shared by every test in this file; hand it back
      // in English afterwards.
      const shared: { i18n?: I18n } = {};
      function CaptureI18n() {
        const { i18n } = useTranslation();
        useEffect(() => {
          shared.i18n = i18n;
        }, [i18n]);
        return null;
      }
      localStorage.setItem('user-locale', 'de');
      try {
        render(
          <>
            <CaptureI18n />
            <WithHeaderActions />
          </>,
        );
        expect(
          await screen.findByRole('button', { name: 'Schließen' }),
        ).toBeInTheDocument();
      } finally {
        localStorage.removeItem('user-locale');
        cleanup();
        await shared.i18n?.changeLanguage('en-US');
      }
    });

    it('draws Close as the house 32px icon button', () => {
      render(<WithHeaderActions />);
      expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
        'size-8',
        'rounded-lg',
        'hover:bg-accent',
      );
    });

    it('puts header actions just before Close, after the content', () => {
      render(<WithHeaderActions />);
      expectClusterOrder();
    });

    it('keeps header actions when Close is hidden', () => {
      render(<WithHeaderActions hideClose />);
      expect(
        screen.getByRole('link', { name: 'Open as page' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
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

    it('leaves focus alone on close when the host hands the reader on', async () => {
      const { rerender } = render(
        <StateOpened open={false} preventCloseAutoFocus />,
      );
      const opener = screen.getByRole('button', { name: 'Opener' });
      opener.focus();
      rerender(<StateOpened open preventCloseAutoFocus />);
      await screen.findByRole('dialog');
      rerender(<StateOpened open={false} preventCloseAutoFocus />);
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(opener).not.toHaveFocus();
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

    it('gives the drawer a close control that closes it', () => {
      const onOpenChange = vi.fn();
      render(<WithHeaderActions onOpenChange={onOpenChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('shows the header actions in the drawer, before Close', () => {
      render(<WithHeaderActions />);
      const { close } = expectClusterOrder();
      // A tap on the cluster must never start a swipe of the sheet.
      expect(close.parentElement).toHaveAttribute('data-vaul-no-drag');
    });

    it('honours hideClose in the drawer', () => {
      render(<WithHeaderActions hideClose />);
      expect(
        screen.getByRole('link', { name: 'Open as page' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
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

    it('passes axe audit with header actions', async () => {
      render(<WithHeaderActions />);
      await checkAccessibility(screen.getByRole('dialog'));
    });

    it('passes axe audit with header actions in the drawer', async () => {
      setViewport({
        '(max-width: 767px)': true,
      });
      render(<WithHeaderActions />);
      await checkAccessibility(screen.getByRole('dialog'));
    });
  });
});
