// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, waitFor } from '@/test/utils/render';

import { CreateStepDialog } from './step-create-dialog';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-123' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

describe('CreateStepDialog', () => {
  afterEach(cleanup);

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CreateStepDialog
          open={true}
          onOpenChange={vi.fn()}
          onCreateStep={vi.fn()}
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
