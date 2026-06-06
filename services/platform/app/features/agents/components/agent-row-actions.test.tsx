// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

const h = vi.hoisted(() => ({
  duplicateMock: vi.fn(() => Promise.resolve({ newAgentName: 'my-agent-1' })),
}));

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
  useDuplicateAgent: () => ({ mutateAsync: h.duplicateMock }),
  useDeleteAgent: () => ({ mutateAsync: vi.fn() }),
}));

import { AgentRowActions } from './agent-row-actions';

describe('AgentRowActions', () => {
  it('reports the new agent name to onDuplicated after duplicating', async () => {
    const onDuplicated = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentRowActions
        agentName="my-agent"
        organizationId="test-org-id"
        onDuplicated={onDuplicated}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'common.actions.openMenu' }),
    );
    await user.click(screen.getByText('common.actions.duplicate'));

    await waitFor(() =>
      expect(onDuplicated).toHaveBeenCalledWith('my-agent-1'),
    );
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AgentRowActions agentName="my-agent" organizationId="test-org-id" />,
      );
      await checkAccessibility(container);
    });
  });
});
