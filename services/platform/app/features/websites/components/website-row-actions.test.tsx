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

vi.mock('../hooks/mutations', () => ({
  useDeleteWebsite: () => ({ mutateAsync: vi.fn() }),
  useUpdateWebsite: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('./website-edit-dialog', () => ({
  EditWebsiteDialog: () => null,
}));

vi.mock('./website-delete-dialog', () => ({
  DeleteWebsiteDialog: () => null,
}));

import { WebsiteRowActions } from './website-row-actions';

const mockWebsite = {
  _id: 'website-1' as const,
  _creationTime: 1700000000000,
  organizationId: 'org-1',
  domain: 'example.com',
  scanInterval: '6h',
} as Parameters<typeof WebsiteRowActions>[0]['website'];

describe('WebsiteRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<WebsiteRowActions website={mockWebsite} />);
      await checkAccessibility(container);
    });
  });
});
