import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ContactInformation } from './contact-information';

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
    name: 'Jane Doe',
    email: 'jane@example.com',
    source: 'manual_import',
    locale: 'de',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ContactInformation', () => {
  it('localizes the raw source enum instead of printing it verbatim (#2643)', () => {
    render(<ContactInformation contact={makeContactDoc()} />);

    expect(screen.getByText('Manual Import')).toBeInTheDocument();
    expect(screen.queryByText('manual_import')).not.toBeInTheDocument();
  });

  it('renders an em-dash instead of fabricating a locale when unset (#2642)', () => {
    render(
      <ContactInformation contact={makeContactDoc({ locale: undefined })} />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('en')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with full contact document', async () => {
      const { container } = render(
        <ContactInformation contact={makeContactDoc()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with ContactInfo data', async () => {
      const { container } = render(
        <ContactInformation contact={makeContactInfo()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with missing optional fields', async () => {
      const { container } = render(
        <ContactInformation
          contact={makeContactDoc({
            name: undefined,
            email: undefined,
            source: undefined,
          })}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with phone', async () => {
      const { container } = render(
        <ContactInformation
          contact={makeContactDoc({ phone: '+1-555-0123' })}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with address', async () => {
      const { container } = render(
        <ContactInformation
          contact={makeContactDoc({
            address: {
              street: '123 Main St',
              city: 'Springfield',
              state: 'IL',
              postalCode: '62701',
              country: 'US',
            },
          })}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with tags', async () => {
      const { container } = render(
        <ContactInformation
          contact={makeContactDoc({ tags: ['electronics', 'wholesale'] })}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with notes', async () => {
      const { container } = render(
        <ContactInformation
          contact={makeContactDoc({ notes: 'Important contact for Q4' })}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with all optional fields', async () => {
      const { container } = render(
        <ContactInformation
          contact={makeContactDoc({
            phone: '+1-555-0123',
            address: {
              street: '456 Oak Ave',
              city: 'Portland',
              state: 'OR',
              postalCode: '97201',
              country: 'US',
            },
            tags: ['supplier', 'preferred'],
            notes: 'Reliable contact with fast responses',
          })}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
