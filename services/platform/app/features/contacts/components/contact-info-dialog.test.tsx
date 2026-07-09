import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ContactInfoDialog } from './contact-info-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function makeContactDoc(overrides = {}) {
  return {
    _id: 'contact-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'John Doe',
    email: 'john@example.com',
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

function makeContactInfo(overrides = {}) {
  return {
    id: 'contact-1',
    name: 'Unknown Contact',
    email: 'unknown@example.com',
    source: 'unknown',
    locale: 'en',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ContactInfoDialog', () => {
  it('renders with full contact document', () => {
    render(
      <ContactInfoDialog
        contact={makeContactDoc()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('renders with ContactInfo fallback data', () => {
    render(
      <ContactInfoDialog
        contact={makeContactInfo()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Unknown Contact')).toBeInTheDocument();
    expect(screen.getByText('unknown@example.com')).toBeInTheDocument();
  });

  it('renders with ContactInfo when name is missing', () => {
    render(
      <ContactInfoDialog
        contact={makeContactInfo({ name: undefined })}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('unknown@example.com')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(
      <ContactInfoDialog
        contact={makeContactInfo()}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Unknown Contact')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ContactInfoDialog
          contact={makeContactDoc()}
          open={true}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
