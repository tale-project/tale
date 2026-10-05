import '@testing-library/jest-dom/vitest';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { Popover } from '../overlays/popover';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '../overlays/responsive-dialog';
import { Dialog } from './dialog';

import '../../globals.css';

const originalPointerEvents = document.body.style.pointerEvents;

afterEach(async () => {
  cleanup();
  document.body.style.pointerEvents = originalPointerEvents;
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

interface InitialState {
  inline: string;
  background: string;
  content: string;
}

/** Runs before Radix's passive pointer-lock effect. The initial modal style
 * pass must already isolate the background without disabling the dialog. */
function InitialStyle({ observed }: { observed: InitialState[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const content = ref.current?.closest<HTMLElement>('[role="dialog"]');
    if (!content) throw new Error('Expected a modal dialog');
    observed.push({
      inline: document.body.style.pointerEvents,
      background: getComputedStyle(document.body).pointerEvents,
      content: getComputedStyle(content).pointerEvents,
    });
  }, [observed]);
  return <span ref={ref}>Details</span>;
}

function Modal({
  responsive,
  open,
  onOpenChange,
  children,
}: {
  responsive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  return responsive ? (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
      >
        <ResponsiveDialogTitle>Task details</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>Read the task</ResponsiveDialogDescription>
        {children}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange} title="Task details">
      {children}
    </Dialog>
  );
}

function Harness({
  responsive = false,
  observed = [],
}: {
  responsive?: boolean;
  observed?: InitialState[];
}) {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open task
      </button>
      <Modal responsive={responsive} open={open} onOpenChange={setOpen}>
        <InitialStyle observed={observed} />
        <input aria-label="Task title" />
        <Popover trigger={<button type="button">Pick status</button>}>
          <button type="button">Ready</button>
        </Popover>
        <button type="button" onClick={() => setNested(true)}>
          Open confirmation
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Dismiss task
        </button>
        <Dialog open={nested} onOpenChange={setNested} title="Confirmation">
          <button type="button" onClick={() => setNested(false)}>
            Dismiss confirmation
          </button>
        </Dialog>
      </Modal>
    </>
  );
}

describe('modal pointer isolation', () => {
  it.each([
    { label: 'Dialog', responsive: false, width: 1280 },
    { label: 'desktop ResponsiveDialog', responsive: true, width: 1280 },
    { label: 'mobile ResponsiveDialog', responsive: true, width: 390 },
  ])(
    'isolates $label in its initial style pass and restores on exit',
    async ({ responsive, width }) => {
      await page.viewport(width, 800);
      const observed: InitialState[] = [];
      render(<Harness responsive={responsive} observed={observed} />);
      await page.getByRole('button', { name: 'Open task' }).click();
      const dialog = screen.getByRole('dialog', { name: 'Task details' });
      expect(observed[0]).toEqual({
        inline: '',
        background: 'none',
        content: 'auto',
      });
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(getComputedStyle(dialog).pointerEvents).toBe('auto');
      expect(document.body.style.pointerEvents).toBe('none');
      await page.getByRole('button', { name: 'Dismiss task' }).click();
      await waitFor(() => {
        expect(dialog).not.toBeInTheDocument();
        expect(document.body.style.pointerEvents).toBe('');
        expect(getComputedStyle(document.body).pointerEvents).toBe('auto');
        expect(screen.getByRole('button', { name: 'Open task' })).toHaveFocus();
      });
    },
  );

  it.each([
    { label: 'Dialog', responsive: false, width: 1280 },
    { label: 'desktop ResponsiveDialog', responsive: true, width: 1280 },
    { label: 'mobile ResponsiveDialog', responsive: true, width: 390 },
  ])(
    'dismisses $label from its backdrop without activating the background',
    async ({ responsive, width }) => {
      await page.viewport(width, 800);
      let backgroundEvents = 0;
      render(
        <>
          <button
            type="button"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              width: 40,
              height: 40,
            }}
            onPointerDown={() => backgroundEvents++}
            onClick={() => backgroundEvents++}
          >
            Background action
          </button>
          <Harness responsive={responsive} />
        </>,
      );
      const background = screen.getByRole('button', {
        name: 'Background action',
      });
      await page.getByRole('button', { name: 'Open task' }).click();
      const dialog = screen.getByRole('dialog', { name: 'Task details' });
      const backdrop = document.elementFromPoint(width - 8, 8);
      expect(backdrop).not.toBe(background);
      expect(dialog.contains(backdrop)).toBe(false);
      if (!backdrop) throw new Error('Expected the modal backdrop');
      await page.elementLocator(backdrop).click({
        position: { x: width - 8, y: 8 },
      });
      await waitFor(() => {
        expect(dialog).not.toBeInTheDocument();
        expect(document.body.style.pointerEvents).toBe('');
        expect(getComputedStyle(document.body).pointerEvents).toBe('auto');
        expect(screen.getByRole('button', { name: 'Open task' })).toHaveFocus();
      });
      expect(backgroundEvents).toBe(0);
      await page.getByRole('button', { name: 'Background action' }).click();
      expect(backgroundEvents).toBe(2);
    },
  );

  it('keeps nonmodal popovers independent and nested layers interactive', async () => {
    await page.viewport(1280, 800);
    const { user } = render(
      <>
        <Popover trigger={<button type="button">Independent picker</button>}>
          <button type="button">Independent option</button>
        </Popover>
        <Harness />
      </>,
    );
    await page.getByRole('button', { name: 'Independent picker' }).click();
    expect(getComputedStyle(document.body).pointerEvents).toBe('auto');
    await page.getByRole('button', { name: 'Independent option' }).click();
    await user.keyboard('{Escape}');
    await page.getByRole('button', { name: 'Open task' }).click();
    await page.getByRole('button', { name: 'Pick status' }).click();
    await page.getByRole('button', { name: 'Ready' }).click();
    expect(getComputedStyle(document.body).pointerEvents).toBe('none');
    await user.keyboard('{Escape}');
    const parent = screen.getByRole('dialog', { name: 'Task details' });
    await page.getByRole('button', { name: 'Open confirmation' }).click();
    const child = screen.getByRole('dialog', { name: 'Confirmation' });
    expect(getComputedStyle(parent).pointerEvents).toBe('none');
    expect(getComputedStyle(child).pointerEvents).toBe('auto');
    expect(child.contains(document.activeElement)).toBe(true);
    await page.getByRole('button', { name: 'Dismiss confirmation' }).click();
    await waitFor(() => {
      expect(child).not.toBeInTheDocument();
      expect(getComputedStyle(parent).pointerEvents).toBe('auto');
      expect(
        screen.getByRole('button', { name: 'Open confirmation' }),
      ).toHaveFocus();
    });
    expect(document.body.style.pointerEvents).toBe('none');
  });

  it.each(['auto', 'none'])(
    'preserves a preexisting inline pointer value of %s',
    async (pointerEvents) => {
      await page.viewport(1280, 800);
      document.body.style.pointerEvents = pointerEvents;
      const { rerender } = render(
        <Modal responsive={false} open={false} onOpenChange={() => {}}>
          <span>Details</span>
        </Modal>,
      );
      rerender(
        <Modal responsive={false} open onOpenChange={() => {}}>
          <span>Details</span>
        </Modal>,
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Task details',
      });
      expect(document.body.style.pointerEvents).toBe('none');
      rerender(
        <Modal responsive={false} open={false} onOpenChange={() => {}}>
          <span>Details</span>
        </Modal>,
      );
      await waitFor(() => {
        expect(dialog).not.toBeInTheDocument();
        expect(document.body.style.pointerEvents).toBe(pointerEvents);
        expect(getComputedStyle(document.body).pointerEvents).toBe(
          pointerEvents,
        );
      });
    },
  );

  it('keeps isolation through the closing animation, then releases it', async () => {
    await page.viewport(1280, 800);
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const style = document.createElement('style');
    style.textContent = `
      @keyframes tale-test-modal-out { from { opacity: 1; } to { opacity: 0; } }
      [role="dialog"][data-state="closed"] {
        animation: tale-test-modal-out 400ms linear forwards;
      }
    `;
    document.head.append(style);
    try {
      render(<Harness responsive />);
      await page.getByRole('button', { name: 'Open task' }).click();
      const dialog = screen.getByRole('dialog', { name: 'Task details' });
      // Assert the real CSS exit immediately after the close request, without
      // spending its duration on a browser-driver round trip.
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss task' }));
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('data-state', 'closed');
      expect(getComputedStyle(document.body).pointerEvents).toBe('none');
      await waitFor(() => {
        expect(dialog).not.toBeInTheDocument();
        expect(getComputedStyle(document.body).pointerEvents).toBe('auto');
        expect(screen.getByRole('button', { name: 'Open task' })).toHaveFocus();
      });
    } finally {
      style.remove();
    }
  });

  it('releases isolation under reduced motion', async () => {
    await page.viewport(1280, 800);
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    render(<Harness />);
    await page.getByRole('button', { name: 'Open task' }).click();
    const dialog = screen.getByRole('dialog', { name: 'Task details' });
    // The shared reduced-motion rule collapses every animation to 0.01ms.
    expect(
      Number.parseFloat(getComputedStyle(dialog).animationDuration),
    ).toBeLessThanOrEqual(0.00001);
    await page.getByRole('button', { name: 'Dismiss task' }).click();
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
      expect(document.body.style.pointerEvents).toBe('');
      expect(getComputedStyle(document.body).pointerEvents).toBe('auto');
    });
  });

  it('leaves a custom portal container to its native layer owner', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const observed: InitialState[] = [];
    try {
      const { unmount } = render(
        <DialogPrimitive.Root open>
          <DialogPrimitive.Portal container={container}>
            <DialogPrimitive.Content data-tale-modal="">
              <DialogPrimitive.Title>Custom portal</DialogPrimitive.Title>
              <DialogPrimitive.Description>
                Custom host
              </DialogPrimitive.Description>
              <InitialStyle observed={observed} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>,
      );
      expect(observed[0]).toEqual({
        inline: '',
        background: 'auto',
        content: 'auto',
      });
      expect(document.body.style.pointerEvents).toBe('none');
      unmount();
      expect(document.body.style.pointerEvents).toBe('');
      expect(getComputedStyle(document.body).pointerEvents).toBe('auto');
    } finally {
      container.remove();
    }
  });
});
