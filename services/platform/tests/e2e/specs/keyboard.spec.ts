import { test as baseTest, expect as baseExpect } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

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
 *    toggles the shared `@tale/ui` `SearchCommand`. Playwright's
 *    `ControlOrMeta+k` maps to Meta on macOS / Control elsewhere — exactly the
 *    handler's `isMod` branch — so one combo is correct cross-OS. The palette
 *    mounts a `role="combobox"` input whose accessible name is the search
 *    placeholder.
 *  - Dialogs — the platform `Dialog` renders a Radix `Dialog.Content`, which
 *    gives Escape-to-close and a focus trap for free. The create-project dialog
 *    is the probe: it's owner-reachable and creates NOTHING until its submit
 *    button is clicked, so opening + Escaping it mutates no org state.
 *  - Wizard — the active `WizardStep` is a `tabIndex={-1}` `role="group"`
 *    labelled by the step name that calls `.focus()` on itself when it becomes
 *    active, so keyboard/SR users land on the new content. The add-org flow's
 *    first step is `workspace` (org name + language).
 *
 * The first-run preferences step exposes an ARIA `radiogroup` with arrow-key
 * nav, but that only renders in `first-run` mode (`/setup` with NO users); the
 * shared backend always already has users, so `/setup` redirects an authed
 * no-org user straight into the add-org wizard. The radiogroup is therefore
 * unreachable here and left to its own component coverage — only the step
 * container auto-focus + Tab-into-first-field path is asserted below.
 */

test.describe('keyboard & focus (owner)', () => {
  // The command-palette shortcut (Ctrl/Cmd+K opens the SearchCommand, Escape
  // closes it) moved to a component test: app/features/chat/components/
  // chat-header.test.tsx (the shortcut is a window keydown listener toggling
  // local React state — pure UI, no real stack). The focus-trap test below stays
  // e2e: jsdom cannot faithfully reproduce Radix's focus trap.
  test('traps focus inside an open dialog', async ({ page, org }) => {
    const { organizationId } = org;

    await page.goto(`/dashboard/${organizationId}/projects`);
    const createButton = page
      .getByRole('button', { name: t('projects.list.createButton') })
      .first();
    await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await createButton.click();

    const dialog = page.getByRole('dialog', {
      name: t('projects.create.title'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Radix moves focus into the dialog on open: exactly one element inside the
    // dialog holds `:focus`. Retry to absorb the open-animation/auto-focus tick.
    await expect(dialog.locator(':focus')).toHaveCount(1, {
      timeout: TIMEOUT.VISIBLE,
    });

    // The focus trap keeps Tab cycling within the dialog — after several Tabs
    // (more than the dialog has focusables, so it must have wrapped) the focused
    // element is still the dialog's, never the page behind it.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
    }
    await expect(dialog.locator(':focus')).toHaveCount(1);

    // Leave no trace: dismiss without submitting (nothing was created).
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
  });
});

/**
 * Wizard focus runs unauthenticated with a per-test throwaway account so it
 * never touches a worker's shared owner org. It uses the BASE Playwright `test`
 * (with an empty storageState) rather than the worker-org fixture, so it never
 * triggers the worker bootstrap. `signUpViaApi(page.request, …)` lands the
 * session cookie in the page's jar, logging the page in as a brand-new user
 * with no org — which routes straight into the add-org wizard.
 */
baseTest.describe('keyboard & focus (wizard, throwaway no-org user)', () => {
  baseTest.use({ storageState: { cookies: [], origins: [] } });

  const CREATE_ORG_URL = /\/dashboard\/create-organization(?:[/?#]|$)/;

  baseTest(
    'moves focus to the active wizard step, which is keyboard-navigable',
    async ({ page }) => {
      const credentials = uniqueCredentials('keyboard-wizard');
      // Unique per-run identity (helper appends a timestamp+random suffix), so
      // this signup never collides with or mutates existing accounts/orgs.
      await signUpViaApi(page.request, credentials);

      // An authed user with no org is sent past `/setup` into the add-org
      // wizard.
      await page.goto('/setup');
      await page.waitForURL(CREATE_ORG_URL, { timeout: TIMEOUT.FIRST_PAINT });

      // The active WizardStep is a `role="group"` labelled by the step name; it
      // calls `.focus()` on itself on activation. The add-org flow opens on the
      // `workspace` step, so that group should hold focus once the wizard
      // mounts.
      const activeStep = page.getByRole('group', {
        name: t('onboarding.steps.workspace'),
      });
      await baseExpect(activeStep).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await baseExpect(activeStep).toBeFocused({ timeout: TIMEOUT.VISIBLE });

      // Keyboard navigation works from there: Tab from the focused step
      // container moves into its first field, the organization-name input. (The
      // first-run preferences radiogroup with arrow-key selection is NOT
      // reachable on this shared backend — see the file header — so only this
      // Tab path is asserted.)
      await page.keyboard.press('Tab');
      await baseExpect(
        page.getByLabel(t('settings.organization.organizationName')),
      ).toBeFocused({ timeout: TIMEOUT.VISIBLE });
    },
  );
});
