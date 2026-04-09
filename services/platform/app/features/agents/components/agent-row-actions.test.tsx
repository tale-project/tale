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

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/shared/constants/agents', () => ({
  PROTECTED_AGENT_NAMES: ['default-agent'],
}));

vi.mock('../hooks/mutations', () => ({
  useDuplicateAgent: () => ({ mutateAsync: vi.fn() }),
  useDeleteAgent: () => ({ mutateAsync: vi.fn() }),
}));

import { AgentRowActions } from './agent-row-actions';

describe('AgentRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AgentRowActions agentName="my-agent" organizationId="test-org-id" />,
      );
      await checkAccessibility(container);
    });
  });
});
