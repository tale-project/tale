import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { FormDialog } from './form-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

/**
 * REAL Chromium (project `browser`) component test migrated from the e2e
 * `keyboard.spec.ts` › "traps focus inside an open dialog". jsdom cannot
 * faithfully reproduce Radix's focus trap (no real `:focus` cycling /
 * focus-guard sentinels), so this lives in the browser tier. The e2e used the
 * create-project dialog purely as a probe for the platform `FormDialog`'s
 * Radix `Dialog.Content` behaviour — opening + Escaping it mutated no org
 * state — so the assertions are about pure client-side focus behaviour and are
 * faithfully reproduced here against the same `FormDialog` component with no
 * backend.
 */

/** A focused element that lives inside the open dialog content. */
function focusIsInsideDialog(): boolean {
  const dialog = screen.queryByRole('dialog');
  const active = document.activeElement;
  return Boolean(dialog && active && dialog.contains(active));
}

/**
 * Harness mirroring the create-project dialog: a button opens a `FormDialog`
 * that holds a couple of fields plus the built-in Cancel/submit footer — more
 * than enough focusables for Tab to need to wrap, exactly like the e2e probe.
 */
function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      title="Create project"
      description="Give your project a name."
      onSubmit={(e) => e.preventDefault()}
      trigger={<button type="button">Create project</button>}
    >
      <label htmlFor="project-name">Name</label>
      <input id="project-name" type="text" />
      <label htmlFor="project-desc">Description</label>
      <input id="project-desc" type="text" />
    </FormDialog>
  );
}

describe('FormDialog focus trap (real browser)', () => {
  it('moves focus into the dialog on open and traps Tab cycling within it', async () => {
    const { user } = render(<DialogHarness />);

    await user.click(screen.getByRole('button', { name: 'Create project' }));

    // The Radix Dialog.Content opens with the matching accessible name.
    const dialog = await screen.findByRole('dialog', {
      name: 'Create project',
    });
    expect(dialog).toBeInTheDocument();

    // Radix moves focus into the dialog on open: exactly one element inside the
    // dialog holds focus. Wait to absorb the open-animation / auto-focus tick.
    await waitFor(() => {
      expect(focusIsInsideDialog()).toBe(true);
    });

    // The focus trap keeps Tab cycling within the dialog — after several Tabs
    // (more than the dialog has focusables, so it must have wrapped) the
    // focused element is still inside the dialog, never the page behind it.
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(focusIsInsideDialog()).toBe(true);
    }

    // Shift+Tab cycles the other direction and stays trapped too.
    for (let i = 0; i < 3; i++) {
      await user.tab({ shift: true });
      expect(focusIsInsideDialog()).toBe(true);
    }

    // Leave no trace: Escape dismisses the dialog (Radix Dialog.Content gives
    // Escape-to-close for free).
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
