import { Button } from '@tale/ui/button';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AccessDenied } from './access-denied';

describe('AccessDenied', () => {
  it('offers what the person can do under the message', () => {
    render(
      <AccessDenied
        message="This session is limited to the organization that signed you in."
        action={<Button>Sign in to this workspace</Button>}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Access denied' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sign in to this workspace' }),
    ).toBeInTheDocument();
  });

  it('offers nothing when it has no action', () => {
    render(
      <AccessDenied message="You do not have permission to view this page." />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AccessDenied message="You do not have permission to view this page." />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with an action', async () => {
      const { container } = render(
        <AccessDenied
          message="This session is limited to the organization that signed you in."
          action={<Button>Sign in to this workspace</Button>}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
