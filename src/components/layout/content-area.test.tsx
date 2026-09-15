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

  it('sets the narrow variant content-area pb token', () => {
    const { container } = render(
      <ContentArea variant="narrow">
        <p>Narrow content</p>
      </ContentArea>,
    );
    expect(container.firstElementChild).toHaveClass('[--content-area-pb:1rem]');
  });
});
