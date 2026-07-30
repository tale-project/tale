import { screen } from '@/tests/utils/render';
import type { render } from '@/tests/utils/render';

type User = Awaited<ReturnType<typeof render>>['user'];

/**
 * Tick one option in a `FilterPanel` — the shared filter affordance behind the
 * toolbar's "Filter" button.
 *
 * Three clicks, because the panel is deliberately compact: open the popover,
 * expand the facet group (all groups start collapsed), then tick the option.
 * Every surface that renders a filter button drives it exactly this way, so the
 * walk lives here rather than being re-typed per test.
 */
export async function pickFilterOption(
  user: User,
  group: string,
  option: string,
) {
  await user.click(screen.getByRole('button', { name: 'Filter' }));
  // Prefix match, not equality: a group that already has a selection appends
  // its "n selected" count to the header's accessible name.
  await user.click(
    await screen.findByRole('button', {
      name: (name) => name.startsWith(group),
    }),
  );
  await user.click(await screen.findByRole('checkbox', { name: option }));
}
