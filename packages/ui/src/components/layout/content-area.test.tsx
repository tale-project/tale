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

  it('sets the page variant content-area pb token', () => {
    const { container } = render(
      <ContentArea>
        <p>Page content</p>
      </ContentArea>,
    );
    expect(container.firstElementChild).toHaveClass(
      '[--content-area-pb:1.5rem]',
    );
    expect(container.firstElementChild).toHaveClass(DOCK_END_PAD);
  });

  it('starts every variant the same distance below the chrome', () => {
    // The inset is one decision, not four. `page` used to sit 8px lower than
    // the rest, which showed up as content jumping between an automation's
    // Editor tab and its Versions tab, and between a page and the list it was
    // opened from.
    for (const variant of ['page', 'list', 'narrow', 'panel'] as const) {
      const { container } = render(
        <ContentArea variant={variant}>
          <p>Content</p>
        </ContentArea>,
      );
      expect(container.firstElementChild).toHaveClass('pt-4');
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

  it('sets the narrow variant content-area pb token', () => {
    const { container } = render(
      <ContentArea variant="narrow">
        <p>Narrow content</p>
      </ContentArea>,
    );
    expect(container.firstElementChild).toHaveClass('[--content-area-pb:1rem]');
  });
});
