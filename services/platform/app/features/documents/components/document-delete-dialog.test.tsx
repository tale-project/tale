// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

import { DocumentDeleteDialog } from './document-delete-dialog';

describe('DocumentDeleteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <DocumentDeleteDialog
          open={true}
          onOpenChange={vi.fn()}
          onConfirmDelete={vi.fn()}
          fileName="test-document.pdf"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
