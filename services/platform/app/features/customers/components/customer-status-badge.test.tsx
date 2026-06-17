import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { CustomerStatusBadge } from './customer-status-badge';

describe('CustomerStatusBadge', () => {
  describe('accessibility', () => {
    it('passes axe audit with active status', async () => {
      const { container } = render(<CustomerStatusBadge status="active" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with churned status', async () => {
      const { container } = render(<CustomerStatusBadge status="churned" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with potential status', async () => {
      const { container } = render(<CustomerStatusBadge status="potential" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with undefined status', async () => {
      const { container } = render(<CustomerStatusBadge status={undefined} />);
      await checkAccessibility(container);
    });
  });
});
