import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CustomerInformation } from './customer-information';

function makeCustomerDoc(overrides = {}) {
  return {
    _id: 'customer-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'John Doe',
    email: 'john@example.com',
    status: 'active' as const,
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

function makeCustomerInfo(overrides = {}) {
  return {
    id: 'customer-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    status: 'potential',
    source: 'circuly',
    locale: 'de',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('CustomerInformation', () => {
  describe('accessibility', () => {
    it('passes axe audit with full customer document', async () => {
      const { container } = render(
        <CustomerInformation customer={makeCustomerDoc()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with CustomerInfo data', async () => {
      const { container } = render(
        <CustomerInformation customer={makeCustomerInfo()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with missing optional fields', async () => {
      const { container } = render(
        <CustomerInformation
          customer={makeCustomerDoc({
            name: undefined,
            email: undefined,
            status: undefined,
            source: undefined,
          })}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
