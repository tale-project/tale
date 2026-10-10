import { fireEvent } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { Dialog } from '../dialog/dialog';
import { isEscapeClaimed, respectEscapeClaims } from './claims-escape';
import { DropdownMenu } from './dropdown-menu';
import { Popover } from './popover';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from './responsive-dialog';
import { Sheet } from './sheet';

/**
 * A widget that uses Escape itself (a code editor with its completion list
 * open) claims it with `data-claims-escape`; the layer it sits in must stay
 * open for a claimed Escape and close for any other.
 */

function Claimant({ claims }: { claims: boolean }) {
  return (
    <div {...(claims ? { 'data-claims-escape': '' } : {})}>
      <input aria-label="Widget" />
    </div>
  );
}

function pressEscape(): void {
  const widget = screen.getByRole('textbox', { name: 'Widget' });
  widget.focus();
  fireEvent.keyDown(widget, { key: 'Escape', code: 'Escape' });
}

type Layer = (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) => ReactNode;

const LAYERS: Array<[string, Layer]> = [
  [
    'Dialog',
    ({ open, onOpenChange, children }) => (
      <Dialog open={open} onOpenChange={onOpenChange} title="Edit">
        {children}
      </Dialog>
    ),
  ],
  [
    'Sheet',
    ({ open, onOpenChange, children }) => (
      <Sheet open={open} onOpenChange={onOpenChange} title="Edit">
        {children}
      </Sheet>
    ),
  ],
  [
    'ResponsiveDialog',
    ({ open, onOpenChange, children }) => (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>Edit</ResponsiveDialogTitle>
          {children}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    ),
  ],
  [
    'Popover',
    ({ open, onOpenChange, children }) => (
      <Popover
        open={open}
        onOpenChange={onOpenChange}
        trigger={<button type="button">Open</button>}
        aria-label="Edit"
      >
        {children}
      </Popover>
    ),
  ],
];

function Harness({ Layer, claims }: { Layer: Layer; claims: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? 'open' : 'closed'}</p>
      <Layer open={open} onOpenChange={setOpen}>
        <Claimant claims={claims} />
      </Layer>
    </>
  );
}

describe('respectEscapeClaims', () => {
  it('cancels a claimed Escape and passes any other to the handler', () => {
    const handler = vi.fn();
    const wrapped = respectEscapeClaims(handler);
    const claimant = document.createElement('div');
    claimant.setAttribute('data-claims-escape', '');
    const inner = document.createElement('input');
    claimant.append(inner);
    document.body.append(claimant);

    const claimed = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    inner.dispatchEvent(claimed);
    wrapped(claimed);
    expect(claimed.defaultPrevented).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(isEscapeClaimed(claimed)).toBe(true);

    const free = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    document.body.dispatchEvent(free);
    wrapped(free);
    expect(free.defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
    claimant.remove();
  });

  it.each(LAYERS)('%s stays open for a claimed Escape', (_name, Layer) => {
    render(<Harness Layer={Layer} claims />);
    pressEscape();
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it.each(LAYERS)('%s closes for an unclaimed Escape', (_name, Layer) => {
    render(<Harness Layer={Layer} claims={false} />);
    pressEscape();
    expect(screen.getByText('closed')).toBeInTheDocument();
  });

  it('DropdownMenu stays open while its content claims Escape', () => {
    function Menu() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <p>{open ? 'open' : 'closed'}</p>
          <DropdownMenu
            open={open}
            onOpenChange={setOpen}
            trigger={<button type="button">Actions</button>}
            items={[[{ type: 'item', label: 'Rename', onClick: () => {} }]]}
          />
        </>
      );
    }
    render(<Menu />);
    const menu = screen.getByRole('menu');
    menu.setAttribute('data-claims-escape', '');
    const item = screen.getByRole('menuitem', { name: 'Rename' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.getByText('open')).toBeInTheDocument();
    menu.removeAttribute('data-claims-escape');
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.getByText('closed')).toBeInTheDocument();
  });
});
