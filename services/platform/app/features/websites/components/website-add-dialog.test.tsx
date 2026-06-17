// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

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

  // Migrated from knowledge.spec.ts e2e
  // ("opens the add-website dialog and renders its fields").
  // Pure dialog-open + field rendering — no real persistence, navigation,
  // streaming, RBAC, or connector call. The e2e deliberately stopped at
  // "fields render" because website CRUD hits the crawler service, which the
  // hermetic stack does not run; the rendered-UI assertions move cleanly here.
  describe('renders the add-website dialog and its fields', () => {
    it('shows the dialog titled "Add website" with the domain and scan-interval fields', () => {
      render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );

      // Dialog opens with the localized title (e2e: getByRole('dialog',
      // { name: t('websites.addWebsite') })).
      const dialog = screen.getByRole('dialog', { name: 'Add website' });
      expect(dialog).toBeInTheDocument();

      // Domain field renders with its label (e2e: getByLabel(t('websites.domain'))).
      expect(screen.getByLabelText('Domain')).toBeInTheDocument();

      // Scan-interval field renders with its label (e2e:
      // getByText(t('websites.scanInterval'))).
      expect(screen.getByText('Scan interval')).toBeInTheDocument();
    });
  });
});
