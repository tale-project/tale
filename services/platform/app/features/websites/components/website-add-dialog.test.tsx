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

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/mutations', () => ({
  useCreateWebsite: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AddWebsiteDialog } from './website-add-dialog';

describe('AddWebsiteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
