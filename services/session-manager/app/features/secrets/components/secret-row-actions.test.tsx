import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';
import { SAMPLE, summaryOf } from '@/tests/utils/secrets-api';

import { SecretRowActions } from './secret-row-actions';

function renderActions() {
  const handlers = { onView: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
  const secret = summaryOf(SAMPLE.credentials);
  const view = renderApp(<SecretRowActions secret={secret} {...handlers} />);
  return { ...view, ...handlers, secret };
}

describe('the menu at the end of a row', () => {
  it('is named for its secret, so that each row of a list has a menu of its own name', () => {
    renderActions();
    expect(
      screen.getByRole('button', { name: 'Actions for Example shop' }),
    ).toBeInTheDocument();
  });

  it('offers to view, edit and delete, in that order', async () => {
    const { user } = renderActions();
    await user.click(
      screen.getByRole('button', { name: 'Actions for Example shop' }),
    );
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['View', 'Edit', 'Delete']);
  });

  it.each([
    ['View', 'onView'],
    ['Edit', 'onEdit'],
    ['Delete', 'onDelete'],
  ] as const)(
    '%s hands the secret, and the menu button to give the focus back to, to its handler',
    async (name, handler) => {
      const view = renderActions();
      const button = screen.getByRole('button', {
        name: 'Actions for Example shop',
      });
      await view.user.click(button);
      await view.user.click(screen.getByRole('menuitem', { name }));
      expect(view[handler]).toHaveBeenCalledTimes(1);
      expect(view[handler]).toHaveBeenCalledWith(view.secret, {
        current: button,
      });
    },
  );

  it('is operated with the keyboard alone', async () => {
    const view = renderActions();
    await view.user.tab();
    expect(
      screen.getByRole('button', { name: 'Actions for Example shop' }),
    ).toHaveFocus();
    await view.user.keyboard('{Enter}');
    await screen.findAllByRole('menuitem');
    await view.user.keyboard('{ArrowDown}{Enter}');
    expect(view.onEdit).toHaveBeenCalledWith(view.secret, expect.anything());
  });

  it('closes with Escape without choosing anything', async () => {
    const view = renderActions();
    await view.user.click(
      screen.getByRole('button', { name: 'Actions for Example shop' }),
    );
    await view.user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    expect(view.onView).not.toHaveBeenCalled();
    expect(view.onEdit).not.toHaveBeenCalled();
    expect(view.onDelete).not.toHaveBeenCalled();
  });

  it('has no accessibility violations, closed and open', async () => {
    const view = renderActions();
    await checkAccessibility(view);
    await view.user.click(
      screen.getByRole('button', { name: 'Actions for Example shop' }),
    );
    await screen.findAllByRole('menuitem');
    // The open menu is drawn outside the component, and a component test has no
    // landmark around the page for it to sit in.
    await checkAccessibility(document.body, {
      rules: { region: { enabled: false } },
    });
  });
});
