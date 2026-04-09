import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { ApiKey } from '../types';
import { ApiKeyRevokeDialog } from './api-key-revoke-dialog';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/use-api-keys', () => ({
  useRevokeApiKey: () => ({ mutate: vi.fn(), isPending: false }),
}));

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    name: 'Test Key',
    start: 'tale_abc',
    prefix: 'tale_',
    userId: 'user-1',
    enabled: true,
    expiresAt: null,
    createdAt: new Date(),
    lastRequest: null,
    ...overrides,
  };
}

describe('ApiKeyRevokeDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ApiKeyRevokeDialog
          open={true}
          onOpenChange={vi.fn()}
          apiKey={makeApiKey()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <ApiKeyRevokeDialog
          open={false}
          onOpenChange={vi.fn()}
          apiKey={makeApiKey()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
