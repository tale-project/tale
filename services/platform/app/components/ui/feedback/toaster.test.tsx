import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import { render } from '@/tests/utils/render';

import { Toaster } from './toaster';

describe('Toaster', () => {
  // Regression: the SW "update available" toast must stay clickable while a
  // modal Sheet/Dialog is open. Those modals portal to <body> and lock
  // `body { pointer-events: none }`; rendered inline, the toast viewport gets
  // trapped in an ancestor stacking context behind the modal — visible but
  // un-clickable. Portaling the viewport to <body> keeps it in the root
  // stacking context (z-100 above the modal's z-50) and interactive.
  it('portals the toast viewport to document.body', () => {
    const { container } = render(<Toaster />);

    const viewport = document.body.querySelector('ol');
    expect(viewport).not.toBeNull();
    // Lives in the <body> tree but OUTSIDE the component's own render
    // container — i.e. it was portaled out of its inline position, so it no
    // longer inherits an ancestor stacking context that a body-portaled modal
    // could paint over.
    expect(document.body.contains(viewport)).toBe(true);
    expect(container.contains(viewport)).toBe(false);
  });

  it('renders a toast and its content inside the portaled viewport', () => {
    render(<Toaster />);

    act(() => {
      toast({ title: 'Update available', description: 'Reload to update' });
    });

    const viewport = document.body.querySelector('ol');
    expect(viewport?.textContent).toContain('Update available');
  });

  // The stack tucks into the top-right corner with a SYMMETRIC inset: the
  // top gap equals the right gap (0.75rem plus the safe-area inset on each
  // axis). The old 4rem header-band offset (#1986) went with the old desktop
  // header; the padding still lives INSIDE the `top-0` box so the cleared
  // strip stays pointer-events-none.
  it('insets the viewport symmetrically from the top-right corner', () => {
    render(<Toaster />);

    const viewport = document.body.querySelector('ol');
    expect(viewport?.className).toContain('pt-[calc(0.75rem+var(--safe-top))]');
    expect(viewport?.className).toContain(
      'pr-[calc(0.75rem+var(--safe-right))]',
    );
  });
});
