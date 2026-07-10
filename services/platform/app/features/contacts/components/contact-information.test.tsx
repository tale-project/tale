import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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
