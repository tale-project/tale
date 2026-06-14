import { expect, test } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Keyboard & focus coverage — the cross-cutting accessibility behaviours no
 * single feature spec owns: the global command-palette shortcut, dialog
 * Escape-to-dismiss, the Radix dialog focus trap, and the onboarding wizard's
 * auto-focus on the active step.
 *
 * Selectors and key combos are read from the real source, not guessed:
 *
 *  - Command palette — `app/features/chat/components/chat-header.tsx` installs a
 *    capturing `window` keydown listener: `(meta on mac | ctrl elsewhere) + K`
 *    (no Shift) toggles the shared `@tale/ui` `SearchCommand`. Playwright's
 *    `ControlOrMeta+k` maps to Meta on macOS and Control elsewhere — exactly the
 *    `isMod` branch the handler uses — so the one combo is correct cross-OS. The
 *    palette mounts a `role="combobox"` input whose accessible name is the
 *    search placeholder (`SearchCommandInput`: `aria-label={placeholder}`).
 *  - Dialogs — the platform `Dialog` (`app/components/ui/dialog/dialog.tsx`)
 *    renders a Radix `Dialog.Content`, which gives Escape-to-close and a focus
 *    trap for free. The create-project dialog (`ProjectCreateDialog`, a
 *    `FormDialog`) is the probe: it's owner-reachable and creates NOTHING until
 *    its submit button is clicked, so opening + Escaping it mutates no state.
 *  - Wizard — `WizardStep` (`app/components/ui/wizard/wizard.tsx`) is a
 *    `tabIndex={-1}` `role="group"` labelled by the step name that calls
 *    `.focus()` on itself when it becomes active, so keyboard/SR users land on
 *    the new content. The add-org flow's first step is `workspace` (org name +
 *    language), NOT a radiogroup.
 *
 * The first-run preferences step DOES expose an ARIA `radiogroup` with
 * arrow/Home/End nav (`steps/preferences-step.tsx`), but that step only renders
 * in `first-run` mode (`/setup` with NO users). The shared backend always has
 * the owner the setup project created, so `/setup` redirects an authed no-org
 * user straight to the add-org wizard — the radiogroup is unreachable here, so
 * its arrow-key model is left to its own component coverage and only the
 * step-container auto-focus is asserted below.
 */

test.describe('keyboard & focus (owner)', () => {
  test('opens the command palette with the keyboard shortcut and closes it with Escape', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();

    await page.goto(`/dashboard/${organizationId}/chat`);

    // Wait for the chat surface to settle — the composer is the stable signal
    // that the chat header (which owns the palette shortcut listener) mounted.
    const composer = page.getByRole('textbox', {
      name: t('chat.aria.chatInput'),
    });
    await expect(composer).toBeVisible({ timeout: 60_000 });

    // Fire the real shortcut: ControlOrMeta+K = Meta on macOS / Control
    // elsewhere, matching the header's `isMod` branch. The listener is on
    // `window` (capture), so a page-level press reaches it.
    await page.keyboard.press('ControlOrMeta+k');

    // The palette mounts its combobox input (aria-label = the search
    // placeholder). Its visibility proves the shortcut opened the palette.
    const paletteInput = page.getByRole('combobox', {
      name: t('dialogs.searchChat.placeholder'),
    });
    await expect(paletteInput).toBeVisible({ timeout: 60_000 });

    // Escape dismisses the Radix dialog the palette is built on.
    await page.keyboard.press('Escape');
    await expect(paletteInput).toBeHidden({ timeout: 60_000 });
  });

  test('closes a dialog when Escape is pressed', async ({ page }) => {
    const { organizationId } = readRunContext();

    // The create-project dialog is a plain Radix dialog and creates nothing
    // until its submit button is clicked — opening + Escaping it is inert.
    await page.goto(`/dashboard/${organizationId}/projects`);
    const createButton = page
      .getByRole('button', { name: t('projects.list.createButton') })
      .first();
    await expect(createButton).toBeVisible({ timeout: 60_000 });
    await createButton.click();

    const dialog = page.getByRole('dialog', {
      name: t('projects.create.title'),
    });
    await expect(dialog).toBeVisible({ timeout: 60_000 });

    // Escape is wired by Radix's Dialog.Content — no submit, so no project is
    // created and the shared backend is untouched.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 60_000 });
  });

  test('traps focus inside an open dialog', async ({ page }) => {
    const { organizationId } = readRunContext();

    await page.goto(`/dashboard/${organizationId}/projects`);
    const createButton = page
      .getByRole('button', { name: t('projects.list.createButton') })
      .first();
    await expect(createButton).toBeVisible({ timeout: 60_000 });
    await createButton.click();

    const dialog = page.getByRole('dialog', {
      name: t('projects.create.title'),
    });
    await expect(dialog).toBeVisible({ timeout: 60_000 });

    // Radix moves focus into the dialog on open: exactly one element inside the
    // dialog holds `:focus`. Retry to absorb the open-animation/auto-focus tick.
    await expect(dialog.locator(':focus')).toHaveCount(1, { timeout: 60_000 });

    // The focus trap keeps Tab cycling within the dialog — after several Tabs
    // (more than the dialog has focusables, so it must have wrapped) the
    // focused element is still the dialog's, never the page behind it.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
    }
    await expect(dialog.locator(':focus')).toHaveCount(1);

    // Leave no trace: dismiss without submitting (nothing was created).
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 60_000 });
  });
});

/**
 * Wizard focus runs unauthenticated with a per-test throwaway account so it
 * never touches the shared owner session. `signUpViaApi(page.request, …)` lands
 * the session cookie in the page's jar, logging the page in as a brand-new
 * user with no org — which routes straight into the add-org wizard.
 */
test.describe('keyboard & focus (wizard, throwaway no-org user)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const CREATE_ORG_URL = /\/dashboard\/create-organization(?:[/?#]|$)/;

  test('moves focus to the active wizard step, which is keyboard-navigable', async ({
    page,
  }) => {
    const credentials = uniqueCredentials('keyboard-wizard');
    // Unique per-run identity (helper appends a timestamp+random suffix), so
    // this signup never collides with or mutates existing accounts/orgs.
    await signUpViaApi(page.request, credentials);

    // An authed user with no org is sent past `/setup` into the add-org wizard.
    await page.goto('/setup');
    await page.waitForURL(CREATE_ORG_URL, { timeout: 120_000 });

    // The active WizardStep is a `role="group"` labelled by the step name; it
    // calls `.focus()` on itself on activation. The add-org flow opens on the
    // `workspace` step, so that group should hold focus once the wizard mounts.
    const activeStep = page.getByRole('group', {
      name: t('onboarding.steps.workspace'),
    });
    await expect(activeStep).toBeVisible({ timeout: 120_000 });
    await expect(activeStep).toBeFocused({ timeout: 60_000 });

    // Keyboard navigation works from there: Tab from the focused step container
    // moves into its first field, the organization-name input. (The first-run
    // preferences radiogroup with arrow-key selection is NOT reachable on this
    // shared backend — see the file header — so only this Tab path is asserted.)
    await page.keyboard.press('Tab');
    await expect(
      page.getByLabel(t('settings.organization.organizationName')),
    ).toBeFocused({ timeout: 60_000 });
  });
});
