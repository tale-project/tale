import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Sheet } from './sheet';

const MISSING_DESCRIPTION_WARNING = 'Missing `Description`';

describe('Sheet', () => {
  describe('accessibility', () => {
    it('marks the content as a modal dialog (aria-modal)', () => {
      render(
        <Sheet open onOpenChange={vi.fn()} title="Sheet Title">
          <p>Sheet content</p>
        </Sheet>,
      );
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    describe('description / aria-describedby', () => {
      let warnSpy: ReturnType<typeof vi.spyOn>;
      beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      });
      afterEach(() => {
        warnSpy.mockRestore();
      });

      const radixDescriptionWarnings = () =>
        warnSpy.mock.calls
          .map((call: unknown[]) => String(call[0]))
          .filter((message: string) =>
            message.includes(MISSING_DESCRIPTION_WARNING),
          );

      // Regression: a description-less Sheet used to leave Radix's default
      // `aria-describedby` pointing at a `Description` node that is never
      // rendered — a dangling ARIA reference Radix warns about in dev
      // (issue #2352). The Sheet must opt out with `aria-describedby={undefined}`.
      it('omits aria-describedby and does not warn when no description is given', () => {
        render(
          <Sheet open onOpenChange={vi.fn()} title="Sheet Title">
            <p>Sheet content</p>
          </Sheet>,
        );
        expect(screen.getByRole('dialog')).not.toHaveAttribute(
          'aria-describedby',
        );
        expect(radixDescriptionWarnings()).toEqual([]);
      });

      it('wires aria-describedby to the rendered description and does not warn', () => {
        render(
          <Sheet
            open
            onOpenChange={vi.fn()}
            title="Sheet Title"
            description="Sheet description"
          >
            <p>Sheet content</p>
          </Sheet>,
        );
        const dialog = screen.getByRole('dialog');
        const describedBy = dialog.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        // The referenced description node must exist (valid ARIA reference).
        expect(document.getElementById(describedBy ?? '')).toHaveTextContent(
          'Sheet description',
        );
        expect(radixDescriptionWarnings()).toEqual([]);
      });
    });

    it('passes axe audit when open', async () => {
      const { container } = render(
        <Sheet
          open={true}
          onOpenChange={vi.fn()}
          title="Sheet Title"
          description="Sheet description"
        >
          <p>Sheet content</p>
        </Sheet>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit without close button', async () => {
      const { container } = render(
        <Sheet open={true} onOpenChange={vi.fn()} title="Sheet Title" hideClose>
          <p>Sheet content</p>
        </Sheet>,
      );
      await checkAccessibility(container);
    });
  });
});
