import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { useUrlState } from './use-url-state';

describe('credential deep-link URL state', () => {
  it.each(['provider', 'connector'])(
    'removes the %s parameter when the facet clears',
    async (parameter) => {
      function Probe() {
        const { state, setState } = useUrlState({
          definitions: { [parameter]: { default: null } },
        });
        return (
          <button onClick={() => setState(parameter, null)}>
            {state[parameter] ?? 'Cleared'}
          </button>
        );
      }

      const history = createMemoryHistory({
        initialEntries: [`/?${parameter}=absent-vendor&keep=1`],
      });
      const router = createRouter({
        routeTree: createRootRoute({ component: Probe }),
        history,
      });
      const { user } = render(<RouterProvider router={router} />);
      await user.click(
        await screen.findByRole('button', { name: 'absent-vendor' }),
      );
      await waitFor(() => {
        const search = new URLSearchParams(history.location.search);
        expect(search.has(parameter)).toBe(false);
        expect(search.get('keep')).toBe('1');
      });
      expect(
        await screen.findByRole('button', { name: 'Cleared' }),
      ).toBeInTheDocument();
    },
  );
});
