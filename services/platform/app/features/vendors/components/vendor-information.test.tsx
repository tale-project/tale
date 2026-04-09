import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { VendorInformation } from './vendor-information';

function makeVendor(overrides = {}) {
  return {
    _id: 'vendor-1' as never,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name: 'Test Vendor',
    email: 'vendor@example.com',
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

describe('VendorInformation', () => {
  describe('accessibility', () => {
    it('passes axe audit with basic vendor data', async () => {
      const { container } = render(<VendorInformation vendor={makeVendor()} />);
      await checkAccessibility(container);
    });

    it('passes axe audit with address', async () => {
      const { container } = render(
        <VendorInformation
          vendor={makeVendor({
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
        <VendorInformation
          vendor={makeVendor({
            tags: ['electronics', 'wholesale'],
          })}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with notes', async () => {
      const { container } = render(
        <VendorInformation
          vendor={makeVendor({
            notes: 'Important vendor for Q4 deliveries',
          })}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with all optional fields', async () => {
      const { container } = render(
        <VendorInformation
          vendor={makeVendor({
            phone: '+1-555-0123',
            address: {
              street: '456 Oak Ave',
              city: 'Portland',
              state: 'OR',
              postalCode: '97201',
              country: 'US',
            },
            tags: ['supplier', 'preferred'],
            notes: 'Reliable supplier with fast shipping',
          })}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
