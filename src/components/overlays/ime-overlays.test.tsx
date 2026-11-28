import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { Dialog } from '../dialog/dialog';
import { Popover } from './popover';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from './responsive-dialog';

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../hooks/use-is-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}));

beforeEach(() => {
  viewport.mobile = false;
});

describe.each(['dialog', 'popover', 'desktop', 'mobile'] as const)(
  '%s IME dismissal',
  (kind) => {
    function overlay(open: boolean, onOpenChange: (open: boolean) => void) {
      const field = <input aria-label="Name" />;
      if (kind === 'dialog')
        return (
          <Dialog open={open} onOpenChange={onOpenChange} title="Editor">
            {field}
          </Dialog>
        );
      if (kind === 'popover')
        return (
          <Popover
            open={open}
            onOpenChange={onOpenChange}
            trigger={<button>Open</button>}
            aria-label="Editor"
          >
            {field}
          </Popover>
        );
      viewport.mobile = kind === 'mobile';
      return (
        <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
          <ResponsiveDialogContent>
            <ResponsiveDialogTitle>Editor</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Edit the name
            </ResponsiveDialogDescription>
            {field}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      );
    }

    it.each(['mirror', 'native', 'Safari'])(
      'keeps Escape inside composition (%s)',
      (signal) => {
        const onOpenChange = vi.fn();
        render(overlay(true, onOpenChange));
        const field = screen.getByRole('textbox', { name: 'Name' });
        fireEvent.compositionStart(field);
        if (signal !== 'mirror') fireEvent.compositionEnd(field);
        fireEvent.keyDown(field, {
          key: 'Escape',
          isComposing: signal === 'native',
          keyCode: signal === 'Safari' ? 229 : 27,
        });
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(field).toBeInTheDocument();
        fireEvent.compositionEnd(field);
        fireEvent.keyDown(field, { key: 'Escape' });
        expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      },
    );

    it('ends a closed composition session, including retained drawer content', async () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(overlay(true, onOpenChange));
      const original = screen.getByRole('textbox', { name: 'Name' });
      fireEvent.compositionStart(original);
      rerender(overlay(false, onOpenChange));
      if (kind === 'mobile') {
        expect(original.closest('[role="dialog"]')).toHaveAttribute(
          'data-state',
          'closed',
        );
      } else {
        expect(original).not.toBeInTheDocument();
      }
      rerender(overlay(true, onOpenChange));
      const reopened = screen.getByRole('textbox', { name: 'Name' });
      fireEvent.keyDown(reopened, {
        key: 'Escape',
      });
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      onOpenChange.mockClear();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      reopened.focus();
      fireEvent.compositionStart(reopened);
      fireEvent.keyDown(reopened, { key: 'Escape' });
      expect(onOpenChange).not.toHaveBeenCalled();
      fireEvent.compositionEnd(reopened);
      fireEvent.keyDown(reopened, { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    });
  },
);
