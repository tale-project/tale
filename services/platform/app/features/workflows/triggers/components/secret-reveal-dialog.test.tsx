// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { SecretRevealDialog } from './secret-reveal-dialog';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-123' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('SecretRevealDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <SecretRevealDialog
          open={true}
          onOpenChange={vi.fn()}
          title="Webhook Secret"
          warning="Store these values securely. They will not be shown again."
          secrets={[
            { label: 'Webhook URL', value: 'https://example.com/webhook/abc' },
            { label: 'Signing Secret', value: 'whsec_test123' },
          ]}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
