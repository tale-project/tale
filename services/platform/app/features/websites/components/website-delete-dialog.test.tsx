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

vi.mock('../hooks/mutations', () => ({
  useDeleteWebsite: () => ({ mutateAsync: vi.fn() }),
}));

import { DeleteWebsiteDialog } from './website-delete-dialog';

const mockWebsite = {
  _id: 'website-1' as const,
  _creationTime: 1700000000000,
  organizationId: 'org-1',
  domain: 'example.com',
  scanInterval: '6h',
} as Parameters<typeof DeleteWebsiteDialog>[0]['website'];

describe('DeleteWebsiteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <DeleteWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          website={mockWebsite}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
