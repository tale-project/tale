// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

const mockResumeScanning = vi.fn();

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
  useResumeScanning: () => ({ mutate: mockResumeScanning }),
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

// A site the crawler paused after repeated failures to reach the knowledge
// database (metadata.scanPausedAt is the flag recordScanFailure writes).
const pausedWebsite = {
  ...mockWebsite,
  status: 'error',
  metadata: { scanPausedAt: 1700000100000 },
} as Parameters<typeof WebsiteRowActions>[0]['website'];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WebsiteRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<WebsiteRowActions website={mockWebsite} />);
      await checkAccessibility(container);
    });
  });

  describe('resume scanning', () => {
    const openMenu = async () => {
      const user = userEvent.setup();
      await user.click(
        screen.getByRole('button', { name: 'common.actions.openMenu' }),
      );
      return user;
    };

    it('offers resume only while the crawler has paused the site', async () => {
      render(<WebsiteRowActions website={mockWebsite} />);
      await openMenu();
      expect(
        screen.queryByText('websites.resumeScanning'),
      ).not.toBeInTheDocument();
    });

    it('resumes a paused site from the row menu', async () => {
      render(<WebsiteRowActions website={pausedWebsite} />);
      const user = await openMenu();
      await user.click(screen.getByText('websites.resumeScanning'));
      expect(mockResumeScanning).toHaveBeenCalledWith({
        websiteId: 'website-1',
      });
    });
  });
});
