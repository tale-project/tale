import { signInViaApi, E2E_PASSWORD } from '../helpers/auth';
import { BASE_URL, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Role-gated org administration. The owner (worker org fixture, an admin) can
 * add a member; that member, signed in in a second browser context, must NOT
 * see the admin-only "Add member" affordance on the same settings page.
 *
 * Lives in its own file because the owner side uses the worker `org` fixture
 * (the rest of the auth cluster is unauthenticated).
 */

test('admin adds a member who cannot see the add-member control', async ({
  page,
  org,
  browser,
}) => {
  const { organizationId } = org;
  const suffix = Date.now().toString(36);
  const memberCreds = {
    email: `e2e-rbac-member-${suffix}@tale.test`,
    password: E2E_PASSWORD,
  };

  await page.goto(`/dashboard/${organizationId}/settings/organization`);

  // The isAdmin-gated "Add member" button opens the add-member dialog.
  const addMemberButton = page.getByRole('button', {
    name: t('settings.organization.addMember'),
  });
  await expect(addMemberButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await addMemberButton.click();

  // Both the dialog title and its submit button read "Add member", so scope
  // fills/submit to the dialog.
  const dialog = page.getByRole('dialog', {
    name: t('dialogs.addMember.title'),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await dialog
    .getByLabel(t('settings.form.name'))
    .fill(`RBAC Member ${suffix}`);
  await dialog.getByLabel(t('settings.form.email')).fill(memberCreds.email);

  // Set the role explicitly via the Radix combobox (named by its "Role" label).
  await dialog.getByRole('combobox', { name: t('settings.form.role') }).click();
  await page
    .getByRole('option', { name: t('settings.roles.member'), exact: true })
    .click();

  // type=password inputs don't expose role=textbox, and the field renders a
  // "Show password" toggle whose aria-label also contains "Password" — so match
  // the label exactly to avoid a strict-mode violation against the toggle.
  await dialog
    .getByLabel(t('settings.form.password'), { exact: true })
    .fill(memberCreds.password);
  await dialog
    .getByRole('button', { name: t('dialogs.addMember.title') })
    .click();

  // A new credentialed member surfaces the generated-credentials view; the
  // success toast confirms the create either way.
  await expect(
    page.getByText(t('toast.success.newMemberCreated.title')).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Second context as the new member: the add-member control is admin-only, so
  // it must be absent for a `member`-role user on the same settings page.
  const memberContext = await browser.newContext({ baseURL: BASE_URL });
  try {
    await signInViaApi(memberContext.request, memberCreds);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/dashboard/${organizationId}/settings/organization`);

    // An admin-provisioned credential must be rotated on first login: the app
    // forces the member through /forced-change-password/<orgId> before any
    // other page mounts. Complete it, then return to the settings page.
    await memberPage.waitForURL(/\/forced-change-password\//, {
      timeout: TIMEOUT.FIRST_PAINT,
    });
    const rotatedPassword = `${E2E_PASSWORD}-r0!`;
    await memberPage
      .getByLabel(t('auth.changePassword.newPassword'), { exact: true })
      .fill(rotatedPassword);
    await memberPage
      .getByLabel(t('auth.changePassword.confirmPassword'), { exact: true })
      .fill(rotatedPassword);
    await memberPage
      .getByRole('button', { name: t('auth.forcedChange.submit') })
      .click();
    await memberPage.waitForURL(/\/dashboard\//, {
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await memberPage.goto(`/dashboard/${organizationId}/settings/organization`);

    // Anchor on the settings rail (always rendered for every role), so we
    // assert after the settings shell has mounted. The org-name field itself is
    // admin-gated — a plain `member` sees an empty org page — so it can't be
    // the anchor, and neither can the admin-gated member search field.
    await expect(
      memberPage.getByRole('navigation', {
        name: t('navigation.userSettings'),
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(
      memberPage.getByRole('button', {
        name: t('settings.organization.addMember'),
      }),
    ).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});
