import { test as baseTest, expect as baseExpect } from '@playwright/test';

import { signUpViaApi, uniqueCredentials } from '../helpers/auth';
import { TIMEOUT } from '../helpers/env';
import { t } from '../helpers/i18n';

/**
 * Keyboard & focus coverage — the cross-cutting accessibility behaviour no
 * single feature spec owns: the onboarding wizard's auto-focus on the active
 * step.
 *
 * Selectors and key combos are read from the real source, not guessed:
 *
 *  - Wizard — the active `WizardStep` is a `tabIndex={-1}` `role="group"`
 *    labelled by the step name that calls `.focus()` on itself when it becomes
 *    active, so keyboard/SR users land on the new content. The add-org flow's
 *    first step is `workspace` (org name). Only the step container auto-focus +
 *    Tab-into-first-field path is asserted below.
 */

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
      // container moves into its first field, the organization-name input.
      await page.keyboard.press('Tab');
      await baseExpect(
        page.getByLabel(t('settings.organization.organizationName')),
      ).toBeFocused({ timeout: TIMEOUT.VISIBLE });
    },
  );
});
