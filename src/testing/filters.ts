import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Tick one option in a `FilterPanel` — the shared filter affordance behind the
 * toolbar's "Filter" button.
 *
 * Three clicks, because the panel is deliberately compact: open the popover,
 * expand the facet group (all groups start collapsed), then tick the option.
 * Every surface that renders a filter button drives it exactly this way, so the
 * walk lives here rather than being re-typed per test — the package's own
 * tests and every consumer's feature tests share it.
 */
export async function pickFilterOption(
  user: UserEvent,
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
