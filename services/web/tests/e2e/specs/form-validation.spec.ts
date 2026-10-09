import { expect, test } from '@playwright/test';
import { createI18n } from '@tale/e2e/i18n';

import { gotoClientPage } from '../helpers/client-page';

for (const locale of ['en', 'de', 'fr'] as const) {
  const { t } = createI18n(
    new URL(`../../../messages/${locale}.yml`, import.meta.url),
  );
  const prefix = locale === 'en' ? '' : `/${locale}`;

  for (const formKind of ['contact', 'request-demo'] as const) {
    const namespace = formKind === 'contact' ? 'contact' : 'requestDemo';

    test(`${locale} ${formKind} validates each field with localized accessible guidance`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.install();
      const submissions: unknown[] = [];
      await page.route('**/api/forms/submit', async (route) => {
        submissions.push(route.request().postDataJSON());
        await route.fulfill({ json: { ok: true } });
      });
      await gotoClientPage(page, `${prefix}/${formKind}`);
      const form = page.locator('form');
      const name = form.getByRole('textbox', {
        name: t(`${namespace}.fieldName`),
        exact: true,
      });
      const email = form.getByRole('textbox', {
        name: t('forms.email'),
        exact: true,
      });
      const company = form.getByRole('textbox', {
        name: t(`${namespace}.fieldCompany`),
        exact: true,
      });
      const message = form.getByRole('textbox', {
        name: t(`${namespace}.fieldMessage`),
        exact: true,
      });
      const consent = form.getByRole('checkbox', {
        name: `${t('forms.privacyPrefix')} ${t('forms.privacyLink')}`,
        exact: true,
      });
      const submit = form.getByRole('button', {
        name: t(`${namespace}.submit`),
        exact: true,
      });
      await expect(
        form.getByRole('link', { name: t('forms.privacyLink'), exact: true }),
      ).toHaveAttribute('href', `${prefix}/legal/privacy-policy`);

      await submit.click();
      await expect(name).toBeFocused();
      await expect(name).toHaveAccessibleDescription(
        t('forms.validation.nameRequired'),
      );
      await expect(email).toHaveAccessibleDescription(
        t('forms.validation.emailRequired'),
      );
      await expect(consent).toHaveAccessibleDescription(
        t('forms.privacyRequired'),
      );
      await expect(consent).toHaveAttribute('aria-invalid', 'true');
      if (formKind === 'contact') {
        await expect(message).toHaveAccessibleDescription(
          t('forms.validation.messageRequired'),
        );
      } else {
        await expect(message).not.toHaveAttribute('aria-invalid', 'true');
      }
      expect(submissions).toHaveLength(0);

      await name.fill('Ada Example');
      await email.fill('not-an-email');
      await email.press('Tab');
      await expect(email).toHaveAccessibleDescription(
        t('forms.validation.emailInvalid'),
      );
      await email.fill('ada@example.com');
      await company.fill('a'.repeat(2001));
      await company.press('Tab');
      await expect(company).toHaveAccessibleDescription(
        t('forms.validation.companyTooLong'),
      );
      await company.fill('Example Company');

      if (formKind === 'contact') {
        await message.fill('short');
        await message.press('Tab');
        await expect(message).toHaveAccessibleDescription(
          t('forms.validation.messageTooShort'),
        );
      } else {
        const phone = form.getByRole('textbox', {
          name: t('requestDemo.fieldPhone'),
          exact: true,
        });
        for (const [value, key] of [
          ['----', 'phoneInvalid'],
          ['abc', 'phoneInvalid'],
          ['12', 'phoneTooShort'],
        ] as const) {
          await phone.fill(value);
          await phone.press('Tab');
          await expect(phone).toHaveAccessibleDescription(
            t(`forms.validation.${key}`),
          );
        }
        await phone.fill('');
      }
      await message.fill('Please help us plan a Tale deployment.');
      await submit.click();
      await expect(consent).toBeFocused();
      expect(submissions).toHaveLength(0);

      await consent.check();
      await page.clock.fastForward(3100);
      await submit.click();
      await expect(page.getByRole('status')).toContainText(
        t('forms.success.title'),
      );
      await expect(
        page.getByRole('heading', {
          name: t('forms.success.title'),
          exact: true,
        }),
      ).toBeFocused();
      expect(submissions).toHaveLength(1);

      await page
        .getByRole('button', {
          name: t('forms.success.sendAnother'),
          exact: true,
        })
        .click();
      await expect(name).toBeFocused();
      await expect(name).toHaveValue('');
      await expect(email).toHaveValue('');
      await expect(consent).not.toBeChecked();
      await name.fill('Grace Example');
      await email.fill('grace@example.com');
      await message.fill('Please schedule a follow-up discussion.');
      await consent.check();
      await page.clock.fastForward(3100);
      await submit.click();
      await expect(page.getByRole('status')).toContainText(
        t('forms.success.title'),
      );
      expect(submissions).toHaveLength(2);
    });
  }
}
