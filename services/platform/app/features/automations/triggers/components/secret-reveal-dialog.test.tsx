// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { SecretRevealDialog } from './secret-reveal-dialog';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-123' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('SecretRevealDialog', () => {
  afterEach(cleanup);

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
