import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { SystemPromptEditor } from './system-prompt-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: {
      config: {
        mandatoryPrefixPrompt: '',
        mandatorySuffixPrompt: '',
      },
    },
    isLoading: false,
  }),
}));

describe('SystemPromptEditor', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <SystemPromptEditor organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});
