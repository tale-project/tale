import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import type { ApiKey } from '../types';
import { ApiKeyRowActions } from './api-key-row-actions';

vi.mock('@tale/ui/use-toast', () => ({
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
    suffix: 'wxyz',
    enabled: true,
    expiresAt: null,
    createdAt: Date.now(),
    lastRequest: null,
    owner: { kind: 'user' },
    role: null,
    createdBy: null,
    canRevoke: true,
    ...overrides,
  };
}

describe('ApiKeyRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ApiKeyRowActions apiKey={makeApiKey()} organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
