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

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('../hooks/mutations', () => ({
  useSaveAgent: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useListProviders: () => ({
    providers: [
      {
        models: [{ id: 'model-1', displayName: 'Test Model' }],
      },
    ],
  }),
}));

import { CreateAgentDialog } from './agent-create-dialog';

describe('CreateAgentDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <CreateAgentDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
