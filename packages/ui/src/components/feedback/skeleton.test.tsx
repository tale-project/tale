import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Skeleton />);
      await checkAccessibility(container);
    });

    it('has status role', () => {
      render(<Skeleton />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has accessible label', () => {
      render(<Skeleton label="Loading users" />);
      expect(screen.getByLabelText('Loading users')).toBeInTheDocument();
    });

    it('has sr-only text', () => {
      render(<Skeleton label="Loading data" />);
      expect(screen.getByText('Loading data')).toBeInTheDocument();
    });
  });
});
