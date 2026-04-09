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

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/convex/lib/type_cast_helpers', () => ({
  toId: (id: string) => id,
}));

vi.mock('../../hooks/actions', () => ({
  useRetryRagIndexing: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/mutations', () => ({
  useDeleteDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteFolder: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { DocumentRowActions } from '../document-row-actions';

describe('DocumentRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit for file row actions', async () => {
      const { container } = render(
        <DocumentRowActions
          documentId="doc-1"
          itemType="file"
          name="test-document.pdf"
          sourceMode="manual"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
