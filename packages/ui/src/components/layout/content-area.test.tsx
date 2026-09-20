import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { ContentArea } from './content-area';

const DOCK_END_PAD =
  'pb-[calc(var(--content-area-pb)+var(--mobile-floating-actions-pad,0px))]';

describe('ContentArea', () => {
  describe('accessibility', () => {
    it('passes axe audit with default variant', async () => {
      const { container } = render(
        <ContentArea>
          <p>Page content</p>
        </ContentArea>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with narrow variant', async () => {
      const { container } = render(
        <ContentArea variant="narrow">
          <p>Narrow content</p>
        </ContentArea>,
      );
      await checkAccessibility(container);
    });
  });

  it('keeps floating-dock end clearance even when className sets py-*', () => {
    const { container } = render(
      <ContentArea className="mx-auto max-w-3xl px-4 py-4">
        <p>Agent tab</p>
      </ContentArea>,
    );
    expect(container.firstElementChild).toHaveClass(DOCK_END_PAD);
  });

  it('carries the dock clearance on the page variant', () => {
    const { container } = render(
      <ContentArea>
        <p>Page content</p>
      </ContentArea>,
    );
    expect(container.firstElementChild).toHaveClass(DOCK_END_PAD);
  });

  it('insets every variant by the same amount on all four sides', () => {
    // The inset is ONE decision. `page` used to start 8px lower than the rest
    // and `page`/`list` used to end 8px further from the bottom than they
    // started, which showed as content jumping between an automation's Editor
    // tab and its Versions tab, and as a workbench whose canvas sat closer to
    // the tab strip than to the window's bottom edge.
    for (const variant of ['page', 'list', 'narrow', 'panel'] as const) {
      const { container } = render(
        <ContentArea variant={variant}>
          <p>Content</p>
        </ContentArea>,
      );
      expect(container.firstElementChild).toHaveClass('pt-4');
      expect(container.firstElementChild).toHaveClass(
        '[--content-area-pb:1rem]',
      );
      expect(container.firstElementChild).toHaveClass(DOCK_END_PAD);
    }
  });

  it('bounds the list variant so the table scrollport takes the overflow', () => {
    // The overview lists (Automations, Projects, Knowledge) all mount their
    // DataTable in this frame. `min-h-0 flex-1` is what makes the table's
    // sticky scrollport — not the page shell — scroll; drop either class and
    // every one of those pages silently goes back to growing the page.
    const { container } = render(
      <ContentArea variant="list">
        <p>Collection</p>
      </ContentArea>,
    );
    expect(container.firstElementChild).toHaveClass('min-h-0');
    expect(container.firstElementChild).toHaveClass('flex-1');
    expect(container.firstElementChild).toHaveClass('px-4');
    expect(container.firstElementChild).toHaveClass(DOCK_END_PAD);
  });

  it('keeps the narrow variant on the settings width', () => {
    const { container } = render(
      <ContentArea variant="narrow">
        <p>Narrow content</p>
      </ContentArea>,
    );
    expect(container.firstElementChild).toHaveClass('max-w-3xl');
  });
});
