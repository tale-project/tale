import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ToolDetailsDialog } from './tool-details-dialog';

vi.mock('@tale/ui/i18n/locale-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/i18n/locale-provider')>()),
  useLocale: () => ({ locale: 'en-US', setLocale: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

describe('ToolDetailsDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit with full usage data', async () => {
      const { container } = render(
        <ToolDetailsDialog
          isOpen={true}
          onOpenChange={vi.fn()}
          usage={{
            toolName: 'integration_assistant',
            model: 'gpt-4',
            provider: 'openai',
            inputTokens: 150,
            outputTokens: 300,
            totalTokens: 450,
            durationMs: 1234,
            input: 'What is in this file?',
            output: 'The file contains project documentation.',
          }}
        />,
      );
      await checkAccessibility(container);
    });

    it('returns null when usage is null', async () => {
      const { container } = render(
        <ToolDetailsDialog isOpen={true} onOpenChange={vi.fn()} usage={null} />,
      );
      await checkAccessibility(container);
    });
  });
});
