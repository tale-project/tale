import type { Locator, Page } from '@playwright/test';

import type { SecretKind, Session } from '../../../lib/api/schemas';
import { MAX_VALUE } from '../../../lib/secret-limits';
import type { AppApi } from '../helpers/api';
import { violationsOf } from '../helpers/axe';
import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { fill, t } from '../helpers/i18n';
import { answerNativeQuestions } from '../helpers/proxies-confirm';
import { cutOff, failRequests } from '../helpers/proxies-faults';
import { openMenuWithKeyboard } from '../helpers/proxies-keyboard';
import { untilStill } from '../helpers/proxies-page';
import {
  accessibilityTreeText,
  format,
  leaksOf,
} from '../helpers/proxies-text';
import {
  ageCell,
  ageOf,
  englishAge,
  eventually,
  KINDS,
  kindLabel,
  scopeText,
  SecretsPage,
  showingAll,
  soon,
  startingField,
  STARTING_FIELDS,
  summaryText,
} from '../helpers/secrets-page';
import {
  CARD,
  CARD_NUMBER,
  CREDENTIALS,
  CVC,
  NOTE,
  PASSWORD,
  PERSONAL,
  sessionsNamed,
  storedSecret,
} from '../helpers/secrets-scene';
import { tabTitle, tIn } from '../helpers/settings-i18n';

// Asking for `api` empties the manager (the fixture resets it): every test of
// the file starts from an empty vault, whether it uses `api` or not.
test.beforeEach(async ({ api }) => {
  expect(await api.secrets()).toEqual([]);
});

// ---------------------------------------------------------------------------
// The empty vault
// ---------------------------------------------------------------------------

test.describe('an empty vault', () => {
  test('says so and offers to add a secret, with nothing to search or narrow', async ({
    page,
  }) => {
    const secrets = await SecretsPage.open(page);
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.secrets')));

    await soon(
      secrets.table.getByRole('heading', {
        level: 2,
        name: t('secrets.empty.title'),
      }),
    ).toBeVisible();
    await expect(secrets.table).toContainText(t('secrets.empty.description'));
    await expect(secrets.addButton).toBeVisible();
    // With no secret there is nothing to search or to narrow.
    await expect(secrets.search).toHaveCount(0);
    await expect(secrets.filterButton).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(0);
  });

  test('opens the form from the empty state, which Cancel leaves without asking', async ({
    page,
    api,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await expect(dialog).toContainText(t('secrets.form.hiddenHint'));
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();
    await expect(secrets.addButton).toBeFocused();
    expect(await api.secrets()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adding a secret of each kind
// ---------------------------------------------------------------------------

type FieldKey = Parameters<typeof startingField>[0];

interface Creation {
  kind: SecretKind;
  title: string;
  /** What is typed into the kind's own fields, by field. */
  values: Partial<Record<FieldKey, string>>;
  /** What the list shows of it (no hidden value; a card its last four digits). */
  preview: string;
  /** The fields that are masked: the server's labels. */
  hidden: string[];
}

const CREATIONS: Creation[] = [
  {
    kind: 'personal',
    title: 'My details',
    values: {
      name: 'Ann Example',
      email: 'ann@example.com',
      phone: '+49 30 1234567',
      address: '1 Main Street\nSpringfield',
      company: 'Example GmbH',
      companyAddress: 'Hauptstrasse 1',
    },
    preview: 'Ann Example · ann@example.com · +49 30 1234567',
    hidden: [],
  },
  {
    kind: 'credentials',
    title: 'Example shop',
    values: {
      website: 'https://shop.example',
      username: 'ann',
      password: PASSWORD,
    },
    preview: 'https://shop.example · ann',
    hidden: ['Password'],
  },
  {
    kind: 'card',
    title: 'Visa ending 4242',
    values: {
      cardholder: 'Ann Example',
      cardNumber: CARD_NUMBER,
      expiry: '12/30',
      cvc: CVC,
    },
    preview: '•••• 4242 · Ann Example · 12/30',
    hidden: ['Card number', 'CVC'],
  },
  {
    kind: 'note',
    title: 'Notes',
    values: { note: 'remember the milk\nand the eggs' },
    preview: 'remember the milk and the eggs',
    hidden: [],
  },
];

test.describe('adding a secret', () => {
  for (const creation of CREATIONS) {
    test(`of the kind ${creation.kind}, with that kind's own fields`, async ({
      page,
      api,
      request,
    }) => {
      const secrets = await SecretsPage.open(page);
      const dialog = await secrets.openCreate();
      // The form opens as the most common kind.
      await expect(
        dialog.getByRole('combobox', { name: t('secrets.form.kind') }),
      ).toHaveText(kindLabel('credentials'));
      await secrets.chooseKind(dialog, creation.kind);

      // The kind's hint, an example of a title, and exactly its own fields.
      await expect(dialog).toContainText(
        t(`secrets.kindHints.${creation.kind}`),
      );
      await expect(secrets.titleField(dialog)).toHaveAttribute(
        'placeholder',
        t(`secrets.titleExamples.${creation.kind}`),
      );
      const fields = STARTING_FIELDS[creation.kind];
      const boxes = secrets.values(dialog).getByRole('textbox');
      await expect(boxes).toHaveCount(fields.length);
      for (const [index, key] of fields.entries()) {
        await expect(boxes.nth(index)).toHaveAccessibleName(startingField(key));
      }

      // Nothing to add until something is typed; a title alone is refused,
      // beside the values, and nothing is added.
      const submit = secrets.submit(dialog, t('secrets.form.createSubmit'));
      await expect(submit).toBeDisabled();
      await secrets.titleField(dialog).fill(creation.title);
      await submit.click();
      await soon(dialog.getByRole('alert')).toHaveText(
        t('secrets.validation.noValues'),
      );
      expect(await api.secrets()).toEqual([]);
      for (const key of fields) {
        const value = creation.values[key];
        if (value === undefined) continue;
        await secrets.valueField(dialog, startingField(key)).fill(value);
      }
      // The refusal goes as the values come.
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      await submit.click();

      // The list shows it at once, for every session, as the kind it is.
      await soon(dialog).toBeHidden();
      await soon(secrets.toast(t('secrets.toasts.created'))).toBeVisible();
      const row = secrets.row(creation.title);
      await soon(row.row).toBeVisible();
      await expect(row.kind).toHaveText(kindLabel(creation.kind));
      await expect(row.scope).toHaveText(scopeText(null));
      await expect(row.details).toHaveText(creation.preview);
      await expect(secrets.footer).toHaveText(showingAll(1));

      // What is stored is what was typed, with the masked fields marked.
      const [summary] = await api.secrets();
      expect(summary).toMatchObject({
        kind: creation.kind,
        title: creation.title,
        session: null,
        preview: creation.preview,
      });
      const stored = await storedSecret(request, summary.id);
      expect(stored.fields.map(({ value }) => value)).toEqual(
        fields.flatMap((key) => creation.values[key] ?? []),
      );
      expect(
        stored.fields.filter((field) => field.hidden).map(({ label }) => label),
      ).toEqual(creation.hidden);

      // Nothing masked is in the list, and it is there after a reload.
      const masked = Object.fromEntries(
        stored.fields
          .filter((field) => field.hidden)
          .map((field) => [field.label, field.value]),
      );
      expect(await leaksOf(page, masked)).toEqual([]);
      await page.reload();
      await soon(secrets.row(creation.title).row).toBeVisible();
      await expect(secrets.row(creation.title).details).toHaveText(
        creation.preview,
      );
    });
  }

  test('keeps what was typed when the kind changes: a value the new kind has no field for stays as a value of its own', async ({
    page,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.valueField(dialog, startingField('username')).fill('ann');
    await secrets.valueField(dialog, startingField('password')).fill(PASSWORD);

    // A card has no user name and no password: both stay, as values of their own.
    await secrets.chooseKind(dialog, 'card');
    await expect(secrets.customRows(dialog)).toHaveCount(2);
    await expect(secrets.customLabel(dialog, 0)).toHaveValue(
      startingField('username'),
    );
    await expect(secrets.customValue(dialog, 0)).toHaveValue('ann');
    await expect(secrets.customLabel(dialog, 1)).toHaveValue(
      startingField('password'),
    );
    await expect(secrets.customValue(dialog, 1)).toHaveValue(PASSWORD);
    // The password is still masked, and still kept out of the list.
    await expect(
      secrets.keepHidden(dialog, startingField('password')),
    ).toBeChecked();
    await expect(secrets.customValue(dialog, 1)).toHaveCSS(
      '-webkit-text-security',
      'disc',
    );
    // The card's own fields are empty.
    await expect(
      secrets.valueField(dialog, startingField('cardNumber')),
    ).toHaveValue('');
    // (The form holds what was typed; the list behind it has none of it.)
    expect(
      await leaksOf(page, { 'the password': PASSWORD }, ['markup', 'text']),
    ).toEqual([]);
  });

  test('for one session, chosen by name from the sessions there are', async ({
    page,
    api,
  }) => {
    const [alpha] = await sessionsNamed(api, 'alpha', 'beta');
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await expect(secrets.scopeSelect(dialog)).toContainText(scopeText(null));
    await secrets.titleField(dialog).fill('Alpha login');

    // The list of sessions is searched by typing.
    await secrets.scopeSelect(dialog).click();
    const popup = page.getByRole('dialog', { name: t('secrets.scope.label') });
    const search = popup.getByRole('combobox', {
      name: t('secrets.scope.search'),
    });
    await expect(popup.getByRole('option')).toHaveText([
      scopeText(null),
      scopeText('alpha'),
      scopeText('beta'),
    ]);
    await search.fill('alp');
    await expect(popup.getByRole('option')).toHaveText([scopeText('alpha')]);
    await search.fill('no such session');
    await expect(popup).toContainText(t('secrets.scope.none'));
    await search.fill('');
    await page
      .getByRole('option', { name: scopeText('alpha'), exact: true })
      .click();
    await expect(secrets.scopeSelect(dialog)).toContainText(scopeText('alpha'));

    await secrets.valueField(dialog, startingField('username')).fill('ann');
    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();
    await soon(dialog).toBeHidden();

    // The row names the session, with a link to it.
    const row = secrets.row('Alpha login');
    await soon(row.scope.getByRole('link', { name: 'alpha' })).toHaveAttribute(
      'href',
      `/sessions/${alpha.id}`,
    );
    expect((await api.secrets())[0].session).toMatchObject({
      id: alpha.id,
      name: 'alpha',
    });
  });
});

// ---------------------------------------------------------------------------
// What the form refuses
// ---------------------------------------------------------------------------

test.describe('the form of a secret', () => {
  test('asks for a title when it is sent without one, beside the field, and goes there', async ({
    page,
    api,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    const submit = secrets.submit(dialog, t('secrets.form.createSubmit'));
    await secrets.valueField(dialog, startingField('username')).fill('ann');
    // Nothing is said while the form is being filled in.
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    await submit.click();
    await soon(dialog.getByRole('alert')).toHaveText(
      t('secrets.validation.titleRequired'),
    );
    await expect(secrets.titleField(dialog)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(secrets.titleField(dialog)).toBeFocused();
    expect(await api.secrets()).toEqual([]);

    // Blanks are no title either.
    await secrets.titleField(dialog).fill('   ');
    await submit.click();
    await expect(dialog.getByRole('alert')).toHaveText(
      t('secrets.validation.titleRequired'),
    );

    // Typing one takes the refusal back.
    await secrets.titleField(dialog).fill('Example shop');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await submit.click();
    await soon(dialog).toBeHidden();
    expect((await api.secrets()).map(({ title }) => title)).toEqual([
      'Example shop',
    ]);
  });

  test('holds a title to 120 characters, counted as a person counts them', async ({
    page,
    api,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    const submit = secrets.submit(dialog, t('secrets.form.createSubmit'));
    await secrets.valueField(dialog, startingField('username')).fill('ann');

    // 121 characters are one too many.
    await secrets.titleField(dialog).fill('x'.repeat(121));
    await submit.click();
    await soon(dialog.getByRole('alert')).toHaveText(
      format(t('secrets.validation.titleTooLong'), { max: 120 }),
    );
    expect(await api.secrets()).toEqual([]);

    // 120 emoji are 120 characters (240 of the units a string is made of).
    const emoji = '😀'.repeat(120);
    await secrets.titleField(dialog).fill(emoji);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await submit.click();
    await soon(dialog).toBeHidden();
    expect((await api.secrets()).map(({ title }) => title)).toEqual([emoji]);

    const again = await secrets.openCreate();
    await secrets.valueField(again, startingField('username')).fill('ann');
    await secrets.titleField(again).fill(`${emoji}😀`);
    await secrets.submit(again, t('secrets.form.createSubmit')).click();
    await soon(again.getByRole('alert')).toBeVisible();
    expect(await api.secrets()).toHaveLength(1);
  });
});

test.describe('the values of a secret', () => {
  test('need a label, and keep a label to 60 characters and a value to 20,000', async ({
    page,
    api,
    request,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    const submit = secrets.submit(dialog, t('secrets.form.createSubmit'));
    await secrets.titleField(dialog).fill('Extras');
    await secrets.addFieldButton(dialog).click();
    // A row that was added is named by its position until it has a label.
    await expect(secrets.customRows(dialog)).toHaveCount(1);
    await expect(
      secrets.values(dialog).getByRole('group', {
        name: fill(t('secrets.row.name'), { position: 1 }),
      }),
    ).toBeVisible();

    // A value without a label: said beside the label, which has the focus.
    await secrets.customValue(dialog, 0).fill('some value');
    await submit.click();
    await soon(dialog.getByRole('alert')).toHaveText(
      t('secrets.validation.labelRequired'),
    );
    await expect(secrets.customLabel(dialog, 0)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(secrets.customLabel(dialog, 0)).toBeFocused();

    // A label of 61 characters.
    await secrets.customLabel(dialog, 0).fill('l'.repeat(61));
    await submit.click();
    await soon(dialog.getByRole('alert')).toHaveText(
      format(t('secrets.validation.labelTooLong'), { max: 60 }),
    );

    // A value of 20,001 characters, named by its label in the refusal.
    await secrets.customLabel(dialog, 0).fill('Extra');
    await secrets.customValue(dialog, 0).fill('v'.repeat(20_001));
    await submit.click();
    await soon(dialog.getByRole('alert')).toHaveText(
      format(t('secrets.validation.valueTooLong'), {
        label: 'Extra',
        max: 20_000,
      }),
    );
    expect(await api.secrets()).toEqual([]);

    // 20,000 characters are as many as a value can have.
    await secrets.customValue(dialog, 0).fill('v'.repeat(20_000));
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await submit.click();
    await soon(dialog).toBeHidden();
    const [summary] = await api.secrets();
    const stored = await storedSecret(request, summary.id);
    expect(stored.fields).toEqual([
      { label: 'Extra', value: 'v'.repeat(20_000), hidden: false },
    ]);
  });

  test('pass the limits of the form but are larger than the server takes: they are refused on top of the form, and the draft stays', async ({
    page,
    api,
  }) => {
    // The form counts characters; the server counts bytes (`MAX_BODY_BYTES`,
    // 1 MiB of backend/lib/http-input.ts), and an emoji is four of them.
    const BODY_LIMIT_BYTES = 1024 * 1024;
    const BYTES_PER_EMOJI = 4;
    const heavy = '😀'.repeat(MAX_VALUE);
    const values =
      Math.ceil(BODY_LIMIT_BYTES / (MAX_VALUE * BYTES_PER_EMOJI)) + 1;
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.titleField(dialog).fill('Too heavy');
    await secrets.valueField(dialog, startingField('username')).fill(heavy);
    for (let index = 0; index < values - 1; index++) {
      await secrets.addFieldButton(dialog).click();
      await secrets.customLabel(dialog, index).fill(`Extra ${index + 1}`);
      await secrets.customValue(dialog, index).fill(heavy);
    }
    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();

    // Said on top of the form, which keeps what was typed.
    await soon(dialog.getByRole('alert')).toHaveText(/\S/);
    await expect(dialog).toBeVisible();
    await expect(secrets.titleField(dialog)).toHaveValue('Too heavy');
    await expect(
      secrets.valueField(dialog, startingField('username')),
    ).toHaveValue(heavy);
    expect(await api.secrets()).toEqual([]);
  });

  test('that are only blanks count for nothing', async ({ page, api }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.titleField(dialog).fill('Blanks');
    await secrets.valueField(dialog, startingField('username')).fill('   ');
    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();
    await soon(dialog.getByRole('alert')).toHaveText(
      t('secrets.validation.noValues'),
    );
    expect(await api.secrets()).toEqual([]);
  });

  test('can be 40 at most: the Add field button stops there, and 40 are saved', async ({
    page,
    api,
    request,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.titleField(dialog).fill('Forty');
    for (const key of STARTING_FIELDS.credentials) {
      await secrets.valueField(dialog, startingField(key)).fill(`first ${key}`);
    }
    // Three starting rows and 37 of its own make 40.
    const own = 40 - STARTING_FIELDS.credentials.length;
    for (let index = 0; index < own; index++) {
      await secrets.addFieldButton(dialog).click();
      await secrets.customLabel(dialog, index).fill(`Label ${index + 1}`);
      await secrets.customValue(dialog, index).fill(`Value ${index + 1}`);
    }
    await expect(secrets.customRows(dialog)).toHaveCount(own);
    await expect(secrets.addFieldButton(dialog)).toBeDisabled();
    await secrets.addFieldButton(dialog).focus();
    await soon(page.getByRole('tooltip')).toHaveText(
      format(t('secrets.validation.tooMany'), { max: 40 }),
    );

    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();
    await soon(dialog).toBeHidden();
    const [summary] = await api.secrets();
    expect((await storedSecret(request, summary.id)).fields).toHaveLength(40);
  });

  test('can have labels and values of their own, named by the label, and be taken away again', async ({
    page,
    api,
    request,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.titleField(dialog).fill('Shop with extras');
    await secrets.valueField(dialog, startingField('username')).fill('ann');

    await secrets.addFieldButton(dialog).click();
    await secrets.customLabel(dialog, 0).fill('Backup code');
    await secrets.customValue(dialog, 0).fill('ABC-123');
    await secrets.addFieldButton(dialog).click();
    await secrets.customLabel(dialog, 1).fill('Customer number');
    await secrets.customValue(dialog, 1).fill('4711');

    // Once it has a label, the row is named by it (so are its buttons).
    await expect(secrets.keepHidden(dialog, 'Backup code')).not.toBeChecked();
    await secrets.valueButton(dialog, 'remove', 'Customer number').click();
    await expect(secrets.customRows(dialog)).toHaveCount(1);
    // The focus stays in reach: on the button that adds a row.
    await expect(secrets.addFieldButton(dialog)).toBeFocused();

    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();
    await soon(dialog).toBeHidden();
    await expect(secrets.row('Shop with extras').details).toHaveText(
      'ann · ABC-123',
    );
    const [summary] = await api.secrets();
    expect((await storedSecret(request, summary.id)).fields).toEqual([
      { label: 'Username', value: 'ann', hidden: false },
      { label: 'Backup code', value: 'ABC-123', hidden: false },
    ]);
  });

  test('are masked by what they are called or look like, as the server decides, and a value can be kept hidden by hand', async ({
    page,
    api,
    request,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.titleField(dialog).fill('Mixed');
    await secrets.valueField(dialog, startingField('username')).fill('ann');
    // A label that names something private, a value that is a card number
    // (whatever it is called), and a value the person chooses to hide.
    const extras: Array<[string, string]> = [
      ['API token', 'tok-4f9a'],
      ['Backup', '4111 1111 1111 1111'],
      ['Nickname', 'annie'],
    ];
    for (const [index, [label, value]] of extras.entries()) {
      await secrets.addFieldButton(dialog).click();
      await secrets.customLabel(dialog, index).fill(label);
      await secrets.customValue(dialog, index).fill(value);
    }
    await secrets.keepHidden(dialog, 'Nickname').check();
    await expect(secrets.keepHidden(dialog, 'Nickname')).toBeChecked();
    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();
    await soon(dialog).toBeHidden();

    const [summary] = await api.secrets();
    const stored = await storedSecret(request, summary.id);
    expect(
      Object.fromEntries(stored.fields.map((f) => [f.label, f.hidden])),
    ).toEqual({
      Username: false,
      'API token': true,
      Backup: true,
      Nickname: true,
    });
    // The list shows the user name and the last four digits of the card, no more.
    await expect(secrets.row('Mixed').details).toHaveText('•••• 1111 · ann');
    expect(
      await leaksOf(page, {
        'the token': 'tok-4f9a',
        'the card number': '4111 1111 1111 1111',
        'the nickname': 'annie',
      }),
    ).toEqual([]);
  });
});

// The title has the focus when the form opens, and empty. The first click on a
// button below it must be the click it is: an error drawn above it between the
// press and the release (as the title's was, when it was said as the title was
// left) would push the button away, and the click would be lost.
test('the first click on "Available to" opens the list of sessions, before anything was typed', async ({
  page,
  api,
}) => {
  await sessionsNamed(api, 'alpha');
  const secrets = await SecretsPage.open(page);
  const dialog = await secrets.openCreate();
  await secrets.scopeSelect(dialog).click();
  await soon(
    page.getByRole('dialog', { name: t('secrets.scope.label') }),
  ).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test.describe('the list of sessions in the form', () => {
  /** Types into the search of the open list, which finds no session while it has none to look through. */
  async function searchSessions(
    secrets: SecretsPage,
    dialog: Locator,
    text: string,
  ): Promise<Locator> {
    await secrets.scopeSelect(dialog).click();
    const list = secrets.page.getByRole('dialog', {
      name: t('secrets.scope.label'),
    });
    await list
      .getByRole('combobox', { name: t('secrets.scope.search') })
      .fill(text);
    return list;
  }

  test('says that the sessions are on their way, and not that there are none, while they are', async ({
    page,
    api,
  }) => {
    await sessionsNamed(api, 'alpha');
    // The answer is held back until the spec lets it go.
    const release = Promise.withResolvers<void>();
    await page.route(
      (url) => url.pathname === '/api/sessions',
      async (route) => {
        await release.promise;
        await route.fallback();
      },
    );
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    const list = await searchSessions(secrets, dialog, 'alp');

    await expect(list).toContainText(t('secrets.scope.loading'));
    await expect(list).not.toContainText(t('secrets.scope.none'));

    release.resolve();
    await expect(list.getByRole('option')).toHaveText([scopeText('alpha')]);
  });

  test('says that the sessions could not be loaded, and not that there are none, when they could not', async ({
    page,
    api,
  }) => {
    await sessionsNamed(api, 'alpha');
    await failRequests(
      page,
      (url, method) => method === 'GET' && url.pathname === '/api/sessions',
    );
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    const list = await searchSessions(secrets, dialog, 'alp');

    await expect(list).toContainText(t('secrets.scope.loadFailed'));
    await expect(list).not.toContainText(t('secrets.scope.none'));
    // The choice that needs no session is still there to be made.
    await list
      .getByRole('combobox', { name: t('secrets.scope.search') })
      .fill('');
    await expect(
      list.getByRole('option', { name: scopeText(null), exact: true }),
    ).toBeVisible();
  });

  test('follows the sessions added, renamed and deleted in the app, when the person goes on from there to Secrets', async ({
    page,
    api,
  }) => {
    await api.addProxies(1);
    const secrets = await SecretsPage.open(page);
    const rail = page.getByRole('navigation', {
      name: t('navigation.aria.main'),
    });
    const goTo = (section: 'sessions' | 'secrets') =>
      rail
        .getByRole('link', { name: t(`navigation.sections.${section}`) })
        .click();
    /** The menu of the session in the list, which a desktop's row shows to a pointer that is over it. */
    const openMenuOf = async (name: string): Promise<void> => {
      const menu = page.getByRole('button', {
        name: fill(t('sessions.row.menu'), { name }),
        exact: true,
      });
      await page
        .getByRole('region', { name: t('sessions.list.label') })
        .getByRole('listitem')
        .filter({ has: menu })
        .hover();
      await menu.click();
    };
    /** The form's list of sessions, read now, and the form left again. */
    const offers = async (names: Array<string | null>): Promise<void> => {
      const dialog = await secrets.openCreate();
      await secrets.scopeSelect(dialog).click();
      const list = page.getByRole('dialog', { name: t('secrets.scope.label') });
      await expect(list.getByRole('option')).toHaveText(names.map(scopeText));
      await page.keyboard.press('Escape');
      await soon(list).toBeHidden();
      await dialog
        .getByRole('button', { name: t('common.actions.cancel') })
        .click();
      await soon(dialog).toBeHidden();
    };

    // The list is read once, and held for a while.
    await offers([null]);

    // A session added on the Sessions page is in it at once.
    await goTo('sessions');
    // With no session yet, the list has an Add session of its own beside the header's.
    await page
      .getByRole('region', { name: t('sessions.list.label') })
      .getByRole('button', { name: t('sessions.panel.add') })
      .click();
    const add = page.getByRole('dialog', { name: t('sessions.add.title') });
    await add
      .getByRole('textbox', { name: t('sessions.add.name') })
      .fill('Zed');
    await add
      .getByRole('button', { name: t('sessions.add.submit'), exact: true })
      .click();
    await soon(add).toBeHidden();
    await goTo('secrets');
    await offers([null, 'Zed']);

    // So is the new name of one that was renamed there...
    await goTo('sessions');
    await openMenuOf('Zed');
    await page
      .getByRole('menuitem', { name: t('sessions.menu.rename') })
      .click();
    const rename = page.getByRole('dialog', {
      name: t('sessions.rename.title'),
    });
    await rename
      .getByRole('textbox', { name: t('sessions.rename.label') })
      .fill('Zulu');
    await rename
      .getByRole('button', { name: t('sessions.rename.submit'), exact: true })
      .click();
    await soon(rename).toBeHidden();
    await goTo('secrets');
    await offers([null, 'Zulu']);

    // ... and the going of one that was deleted.
    await goTo('sessions');
    await openMenuOf('Zulu');
    await page
      .getByRole('menuitem', { name: t('common.actions.delete') })
      .click();
    const remove = page.getByRole('dialog', {
      name: fill(t('sessions.delete.title'), {
        name: fill(t('sessions.quoted'), { text: 'Zulu' }),
      }),
    });
    await remove
      .getByRole('button', { name: t('sessions.delete.confirm'), exact: true })
      .click();
    await soon(remove).toBeHidden();
    await goTo('secrets');
    await offers([null]);
  });

  test('tells that only the newest sessions are listed, when there are more than one request returns', async ({
    page,
    api,
  }) => {
    await sessionsNamed(api, 'alpha');
    // One request returns the newest 500 sessions and says how many there are:
    // making 501 sessions is not what is under test, so the answer is told so.
    const TOTAL = 700;
    await page.route(
      (url) => url.pathname === '/api/sessions',
      async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          headers: { ...response.headers(), 'x-total-count': String(TOTAL) },
        });
      },
    );
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.scopeSelect(dialog).click();
    const list = page.getByRole('dialog', { name: t('secrets.scope.label') });

    await expect(list.getByRole('option')).toHaveText([
      scopeText(null),
      scopeText('alpha'),
    ]);
    await expect(
      list.getByText(
        format(t('secrets.scope.capped'), { count: 1, total: TOTAL }),
      ),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Hidden values
// ---------------------------------------------------------------------------

test.describe('hidden values', () => {
  test('are masked in the form until revealed, and masked again when hidden', async ({
    page,
    api,
  }) => {
    await api.createSecret(CARD);
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openEdit(CARD.title);

    const masked: Array<[ReturnType<typeof startingField>, string]> = [
      [startingField('cardNumber'), CARD_NUMBER],
      [startingField('cvc'), CVC],
    ];
    for (const [label, value] of masked) {
      const field = secrets.valueField(dialog, label);
      const show = secrets.valueButton(dialog, 'show', label);
      const hide = secrets.valueButton(dialog, 'hide', label);

      // The value is in the field, to be changed, but drawn as dots: a hidden
      // value of one line is a password field.
      await expect(field).toHaveValue(value);
      await expect(field).toHaveAttribute('type', 'password');
      await expect(field).toHaveCSS('-webkit-text-security', 'disc');
      await expect(hide).toHaveCount(0);

      await show.click();
      await expect(field).toHaveAttribute('type', 'text');
      await expect(field).toHaveCSS('-webkit-text-security', 'none');
      await expect(field).toHaveValue(value);
      await expect(show).toHaveCount(0);

      await hide.click();
      await expect(field).toHaveAttribute('type', 'password');
      await expect(field).toHaveCSS('-webkit-text-security', 'disc');
      await expect(show).toBeVisible();
    }

    // The others are shown as they are, and have nothing to reveal.
    const holder = secrets.valueField(dialog, startingField('cardholder'));
    await expect(holder).toHaveValue('Ann Example');
    await expect(holder).toHaveAttribute('type', 'text');
    await expect(holder).toHaveCSS('-webkit-text-security', 'none');
    await expect(
      secrets.valueButton(dialog, 'show', startingField('cardholder')),
    ).toHaveCount(0);

    // Revealing is the form's own business: the page text has no value in it.
    await secrets.valueButton(dialog, 'show', startingField('cvc')).click();
    expect(
      await leaksOf(page, { 'the card number': CARD_NUMBER, 'the CVC': CVC }, [
        'markup',
        'text',
      ]),
    ).toEqual([]);
  });

  test('are kept back in the details until shown, and hidden again, without ever reaching the page by copying', async ({
    page,
    api,
  }) => {
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openView(CREDENTIALS.title);
    const named = { 'the password': PASSWORD };

    // The dialog says what the secret is and for whom, and lists its values.
    await expect(dialog).toContainText(CREDENTIALS.title);
    await expect(dialog).toContainText(summaryText('credentials', null));
    await expect(dialog).toContainText('https://shop.example');
    await expect(dialog).toContainText('ann');
    // The password is not in the page at all: "Hidden" stands for it.
    await expect(dialog).toContainText(t('secrets.view.hidden'));
    expect(await leaksOf(page, named)).toEqual([]);

    // Copying takes the value without showing it.
    const label = startingField('password');
    await secrets.valueButton(dialog, 'copy', label).click();
    await soon(
      dialog.getByText(fill(t('secrets.row.copied'), { label })),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      PASSWORD,
    );
    expect(await leaksOf(page, named)).toEqual([]);

    // Show puts it on the page; Hide takes it off again.
    await secrets.valueButton(dialog, 'show', label).click();
    await expect(dialog).toContainText(PASSWORD);
    await secrets.valueButton(dialog, 'hide', label).click();
    await expect(dialog).not.toContainText(PASSWORD);
    expect(await leaksOf(page, named)).toEqual([]);

    // A value that is not hidden has no toggle, and copies as it is.
    await expect(
      secrets.valueButton(dialog, 'show', startingField('username')),
    ).toHaveCount(0);
    await secrets
      .valueButton(dialog, 'copy', startingField('username'))
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'ann',
    );
  });

  test('copying from the form takes the typed value and leaves it masked', async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    const label = startingField('password');
    const field = secrets.valueField(dialog, label);
    await secrets.titleField(dialog).fill('Copy me');
    await page.evaluate(() => navigator.clipboard.writeText('before'));

    // Nothing typed, nothing to copy: the clipboard keeps what it had.
    await secrets.valueButton(dialog, 'copy', label).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'before',
    );

    await field.fill(PASSWORD);
    await secrets.valueButton(dialog, 'copy', label).click();
    await soon(
      dialog.getByText(fill(t('secrets.row.copied'), { label })),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      PASSWORD,
    );
    // Copying did not show it.
    await expect(field).toHaveCSS('-webkit-text-security', 'disc');
  });

  test('typed into the form are not in what the browser tells a screen reader, until the person shows them', async ({
    page,
  }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    const label = startingField('password');
    const password = secrets.valueField(dialog, label);
    await secrets.titleField(dialog).fill('Leak test');
    await secrets.valueField(dialog, startingField('username')).fill('ann');
    await password.fill(PASSWORD);

    // The browser's own tree: the user name typed into a plain field is in it
    // (so the check can see a value), the password only as dots.
    await expect(password).toHaveAttribute('type', 'password');
    const hidden = await accessibilityTreeText(page);
    expect(hidden).toContain('ann');
    expect(hidden).not.toContain(PASSWORD);

    // Showing it is the person's own act, and then it is text like any other.
    await secrets.valueButton(dialog, 'show', label).click();
    await expect(password).toHaveAttribute('type', 'text');
    expect(await accessibilityTreeText(page)).toContain(PASSWORD);

    await secrets.valueButton(dialog, 'hide', label).click();
    await expect(password).toHaveAttribute('type', 'password');
    expect(await accessibilityTreeText(page)).not.toContain(PASSWORD);
  });

  test('are asked of the backend only when a dialog opens the secret', async ({
    page,
    api,
  }) => {
    const created = await api.createSecret(CARD);
    const asked: string[] = [];
    const listed: string[] = [];
    page.on('response', async (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/secrets')) return;
      asked.push(`${response.request().method()} ${url.pathname}`);
      if (url.pathname === '/api/secrets') listed.push(await response.text());
    });

    const secrets = await SecretsPage.open(page);
    await soon(secrets.row(CARD.title).row).toBeVisible();
    // The list has no values at all, hidden or not; the whole secret is not asked for.
    expect(asked.every((request) => request === 'GET /api/secrets')).toBe(true);
    expect(listed.length).toBeGreaterThan(0);
    for (const body of listed) {
      expect(body).not.toContain(CARD_NUMBER);
      expect(body).not.toContain(CVC);
      expect(body).not.toContain('"fields"');
    }

    await secrets.openView(CARD.title);
    await expect
      .poll(
        () =>
          asked.filter(
            (request) => request === `GET /api/secrets/${created.id}`,
          ).length,
        {
          message: 'the secret is asked for when the details open',
        },
      )
      .toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Changing a secret
// ---------------------------------------------------------------------------

test.describe('changing a secret', () => {
  test('a title alone leaves the values, hidden ones included, as they were', async ({
    page,
    api,
    request,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openEdit(CREDENTIALS.title);

    // The form says which kind it holds and offers no other.
    await expect(dialog).toContainText(kindLabel('credentials'));
    await expect(
      dialog.getByRole('combobox', { name: t('secrets.form.kind') }),
    ).toHaveCount(0);
    // Nothing changed, nothing to save.
    const save = secrets.submit(dialog, t('common.actions.save'));
    await expect(save).toBeDisabled();

    await secrets.titleField(dialog).fill('Example shop, renamed');
    await expect(save).toBeEnabled();
    await save.click();
    await soon(dialog).toBeHidden();
    await soon(secrets.toast(t('secrets.toasts.saved'))).toBeVisible();

    await soon(secrets.row('Example shop, renamed').row).toBeVisible();
    await expect(secrets.row(CREDENTIALS.title).row).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(1);
    const stored = await storedSecret(request, created.id);
    expect(stored.title).toBe('Example shop, renamed');
    expect(stored.fields).toEqual(created.fields);
    expect(stored.fields.find((field) => field.hidden)?.value).toBe(PASSWORD);

    await page.reload();
    await soon(secrets.row('Example shop, renamed').row).toBeVisible();
  });

  test('a value can be changed, one added and one taken away, and a value left alone keeps its mask', async ({
    page,
    api,
    request,
  }) => {
    const created = await api.createSecret({
      ...CREDENTIALS,
      fields: [
        ...CREDENTIALS.fields,
        { label: 'Backup code', value: 'ABC-123' },
      ],
    });
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openEdit(CREDENTIALS.title);

    // The stored values come back into the form: the starting rows by their
    // own fields, any other as a row of its own, with its label.
    await expect(
      secrets.valueField(dialog, startingField('username')),
    ).toHaveValue('ann');
    await expect(secrets.customRows(dialog)).toHaveCount(1);
    await expect(secrets.customLabel(dialog, 0)).toHaveValue('Backup code');
    await expect(secrets.customValue(dialog, 0)).toHaveValue('ABC-123');

    await secrets.valueField(dialog, startingField('username')).fill('bob');
    await secrets.valueButton(dialog, 'remove', 'Backup code').click();
    await secrets.addFieldButton(dialog).click();
    await secrets.customLabel(dialog, 0).fill('Customer number');
    await secrets.customValue(dialog, 0).fill('4711');
    await secrets.submit(dialog, t('common.actions.save')).click();
    await soon(dialog).toBeHidden();

    await expect(secrets.row(CREDENTIALS.title).details).toHaveText(
      'https://shop.example · bob · 4711',
    );
    const stored = await storedSecret(request, created.id);
    expect(stored.fields).toEqual([
      { label: 'Website', value: 'https://shop.example', hidden: false },
      { label: 'Username', value: 'bob', hidden: false },
      { label: 'Password', value: PASSWORD, hidden: true },
      { label: 'Customer number', value: '4711', hidden: false },
    ]);
  });

  test('a lock hides a value from the list and unlocking shows it again', async ({
    page,
    api,
    request,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const username = startingField('username');
    await expect(secrets.row(CREDENTIALS.title).details).toHaveText(
      'https://shop.example · ann',
    );

    let dialog = await secrets.openEdit(CREDENTIALS.title);
    const lock = secrets.keepHidden(dialog, username);
    await expect(lock).not.toBeChecked();
    await lock.check();
    await expect(lock).toBeChecked();
    // Locked, the value is drawn as dots and gets its Show and Copy.
    await expect(secrets.valueField(dialog, username)).toHaveCSS(
      '-webkit-text-security',
      'disc',
    );
    await expect(secrets.valueButton(dialog, 'show', username)).toBeVisible();
    await secrets.submit(dialog, t('common.actions.save')).click();
    await soon(dialog).toBeHidden();

    await expect(secrets.row(CREDENTIALS.title).details).toHaveText(
      'https://shop.example',
    );
    expect(
      (await storedSecret(request, created.id)).fields.find(
        (field) => field.label === 'Username',
      ),
    ).toEqual({ label: 'Username', value: 'ann', hidden: true });

    // Unlocked, it is part of the list again.
    dialog = await secrets.openEdit(CREDENTIALS.title);
    await expect(secrets.keepHidden(dialog, username)).toBeChecked();
    await secrets.keepHidden(dialog, username).uncheck();
    await secrets.submit(dialog, t('common.actions.save')).click();
    await soon(dialog).toBeHidden();
    await expect(secrets.row(CREDENTIALS.title).details).toHaveText(
      'https://shop.example · ann',
    );
  });

  test('who it is for: moved from every session to a session, to another, and back', async ({
    page,
    api,
    request,
  }) => {
    const [alpha, beta] = await sessionsNamed(api, 'alpha', 'beta');
    const created = await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const row = secrets.row(CREDENTIALS.title);
    await expect(row.scope).toHaveText(scopeText(null));

    const moves: Array<[string | null, number | null]> = [
      ['alpha', alpha.id],
      ['beta', beta.id],
      [null, null],
    ];
    let current: string | null = null;
    for (const [session, id] of moves) {
      const dialog = await secrets.openEdit(CREDENTIALS.title);
      await expect(secrets.scopeSelect(dialog)).toContainText(
        scopeText(current),
      );
      await secrets.chooseScope(dialog, session);
      await expect(secrets.scopeSelect(dialog)).toContainText(
        scopeText(session),
      );
      await secrets.submit(dialog, t('common.actions.save')).click();
      await soon(dialog).toBeHidden();

      if (session === null) {
        await expect(row.scope).toHaveText(scopeText(null));
      } else {
        await expect(
          row.scope.getByRole('link', { name: session }),
        ).toHaveAttribute('href', `/sessions/${id}`);
      }
      const stored = await storedSecret(request, created.id);
      expect(stored.session?.id ?? null).toBe(id);
      // Only who it is for changed.
      expect(stored.fields).toEqual(created.fields);
      current = session;
    }
  });

  test('can be started from the details, which the form hands over to and takes back', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const details = await secrets.openView(CREDENTIALS.title);

    await details
      .getByRole('button', { name: t('secrets.actions.edit') })
      .click();
    await soon(secrets.editDialog).toBeVisible();
    await expect(secrets.titleField(secrets.editDialog)).toHaveValue(
      CREDENTIALS.title,
    );
    // Cancel with nothing changed goes back to the details.
    await secrets.editDialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(secrets.viewDialog).toBeVisible();
    await expect(secrets.editDialog).toHaveCount(0);

    // Save closes both.
    await secrets.viewDialog
      .getByRole('button', { name: t('secrets.actions.edit') })
      .click();
    await soon(secrets.editDialog).toBeVisible();
    await secrets
      .titleField(secrets.editDialog)
      .fill('Renamed from the details');
    await secrets.submit(secrets.editDialog, t('common.actions.save')).click();
    await soon(secrets.editDialog).toBeHidden();
    await soon(secrets.viewDialog).toBeHidden();
    await soon(secrets.row('Renamed from the details').row).toBeVisible();
  });

  test('asks before it throws away changes, and never when there are none', async ({
    page,
    api,
    request,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const questions = answerNativeQuestions(page);

    // Nothing changed: Cancel leaves without a question.
    let dialog = await secrets.openEdit(CREDENTIALS.title);
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();
    expect(questions.asked).toEqual([]);

    // A change: Cancel, Escape and Close ask; "no" keeps the form and the change.
    dialog = await secrets.openEdit(CREDENTIALS.title);
    await secrets.titleField(dialog).fill('Changed');
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await expect.poll(() => questions.asked.length).toBe(1);
    await expect(dialog).toBeVisible();
    await expect(secrets.titleField(dialog)).toHaveValue('Changed');
    await page.keyboard.press('Escape');
    await expect.poll(() => questions.asked.length).toBe(2);
    await dialog.getByRole('button', { name: t('common.aria.close') }).click();
    await expect.poll(() => questions.asked.length).toBe(3);
    await expect(dialog).toBeVisible();
    expect(new Set(questions.asked)).toEqual(
      new Set([t('common.discardChangesConfirm')]),
    );

    // "Yes" throws the change away.
    questions.answer(true);
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();
    expect((await storedSecret(request, created.id)).title).toBe(
      CREDENTIALS.title,
    );
    await expect(secrets.row(CREDENTIALS.title).row).toBeVisible();
  });

  test('says on top of the form that the secret is gone, when it was deleted meanwhile', async ({
    page,
    api,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openEdit(CREDENTIALS.title);
    await secrets.titleField(dialog).fill('Too late');

    await api.deleteSecret(created.id);
    await secrets.submit(dialog, t('common.actions.save')).click();
    await soon(dialog.getByRole('alert')).toHaveText(
      t('errors.secret_not_found'),
    );
    // The form stays, with what was typed, for the person to read and decide.
    await expect(secrets.titleField(dialog)).toHaveValue('Too late');
  });

  test('says on top of the form that the session is gone, when it was deleted meanwhile', async ({
    page,
    api,
    request,
  }) => {
    const [alpha, beta] = await sessionsNamed(api, 'alpha', 'beta');
    const created = await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openEdit(CREDENTIALS.title);
    await secrets.chooseScope(dialog, 'alpha');

    await api.deleteSession(alpha.id);
    await secrets.submit(dialog, t('common.actions.save')).click();
    await soon(dialog.getByRole('alert')).toHaveText(
      t('errors.session_not_found'),
    );
    expect((await storedSecret(request, created.id)).session).toBeNull();

    // Another choice is still possible, and the refusal goes with the save.
    await secrets.chooseScope(dialog, 'beta');
    await secrets.submit(dialog, t('common.actions.save')).click();
    await soon(dialog).toBeHidden();
    expect((await storedSecret(request, created.id)).session?.id).toBe(beta.id);
  });
});

// ---------------------------------------------------------------------------
// Deleting a secret
// ---------------------------------------------------------------------------

test.describe('deleting a secret', () => {
  test('asks first, naming the secret; Cancel, Escape and Close keep it, the confirmation removes it', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    await api.createSecret(NOTE);
    const secrets = await SecretsPage.open(page);
    await expect(secrets.rows).toHaveCount(2);

    const dialog = await secrets.openDelete(CREDENTIALS.title);
    await expect(dialog).toContainText(t('secrets.delete.description'));
    await expect(dialog).toContainText(CREDENTIALS.title);
    await expect(dialog).toContainText(summaryText('credentials', null));
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();

    await secrets.openDelete(CREDENTIALS.title);
    await page.keyboard.press('Escape');
    await soon(dialog).toBeHidden();

    await secrets.openDelete(CREDENTIALS.title);
    await dialog.getByRole('button', { name: t('common.aria.close') }).click();
    await soon(dialog).toBeHidden();
    expect(await api.secrets()).toHaveLength(2);
    await expect(secrets.rows).toHaveCount(2);

    await secrets.openDelete(CREDENTIALS.title);
    await secrets.deleteConfirm(dialog).click();
    await soon(dialog).toBeHidden();
    await soon(secrets.toast(t('secrets.toasts.deleted'))).toBeVisible();
    await expect(secrets.row(CREDENTIALS.title).row).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(1);
    await expect(secrets.footer).toHaveText(showingAll(1));
    expect((await api.secrets()).map(({ title }) => title)).toEqual([
      NOTE.title,
    ]);

    // The last one leaves the empty state.
    await page.reload();
    const last = await secrets.openDelete(NOTE.title);
    await secrets.deleteConfirm(last).click();
    await soon(
      secrets.table.getByRole('heading', { name: t('secrets.empty.title') }),
    ).toBeVisible();
    expect(await api.secrets()).toEqual([]);
  });

  test('of a secret for one session says whom it was for, and leaves the session', async ({
    page,
    api,
  }) => {
    const [alpha] = await sessionsNamed(api, 'alpha');
    await api.createSecret({ ...CARD, sessionId: alpha.id });
    const secrets = await SecretsPage.open(page);

    const dialog = await secrets.openDelete(CARD.title);
    await expect(dialog).toContainText(summaryText('card', 'alpha'));
    await secrets.deleteConfirm(dialog).click();
    await soon(dialog).toBeHidden();
    await expect(secrets.rows).toHaveCount(0);
    expect(await api.secrets()).toEqual([]);
    expect((await api.session(alpha.id)).status).toBe('running');
  });

  test('of a secret that is gone already closes the question and tells it could not be deleted', async ({
    page,
    api,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openDelete(CREDENTIALS.title);

    await api.deleteSecret(created.id);
    await secrets.deleteConfirm(dialog).click();
    await soon(dialog).toBeHidden();
    await soon(secrets.toast(t('secrets.toasts.deleteFailed'))).toBeVisible();
    // The list catches up with what it was not told.
    await eventually(secrets.row(CREDENTIALS.title).row).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Narrowing and searching the list
// ---------------------------------------------------------------------------

async function seedVault(
  api: AppApi,
): Promise<{ alpha: Session; beta: Session }> {
  const [alpha, beta] = await sessionsNamed(api, 'alpha', 'beta');
  await api.createSecret({ ...CREDENTIALS, title: 'Global login' });
  await api.createSecret({ ...CARD, title: 'Global card' });
  await api.createSecret({ ...NOTE, title: 'Global note' });
  await api.createSecret({
    ...PERSONAL,
    title: 'Alpha details',
    sessionId: alpha.id,
  });
  await api.createSecret({
    ...CREDENTIALS,
    title: 'Alpha login',
    sessionId: alpha.id,
  });
  await api.createSecret({ ...CARD, title: 'Beta card', sessionId: beta.id });
  return { alpha, beta };
}

/** The secrets the table lists, whatever their order. */
async function expectListed(
  secrets: SecretsPage,
  titles: string[],
): Promise<void> {
  await expect
    .poll(async () => (await secrets.titles()).sort(), {
      timeout: TIMEOUT.VISIBLE,
      message: 'the secrets on the table',
    })
    .toEqual([...titles].sort());
}

/** The choices of one group of the filters' panel, left open. */
async function choicesOf(
  secrets: SecretsPage,
  group: 'type' | 'scope',
): Promise<Locator> {
  const title = t(`secrets.filters.${group}`);
  await secrets.filterButton.click();
  await soon(secrets.filterPanel).toBeVisible();
  const section = secrets.filterPanel.getByRole('button', {
    name: title,
    exact: true,
  });
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click();
  }
  return secrets.filterPanel
    .getByRole('radiogroup', { name: title })
    .getByRole('radio');
}

test.describe('narrowing the list', () => {
  test('by type: the panel offers every type, a choice shows the secrets of that type with its chip, All lifts it', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    await expect(secrets.rows).toHaveCount(6);
    await expect(secrets.chips).toHaveCount(0);

    const choices = await choicesOf(secrets, 'type');
    await expect(choices).toHaveText([
      t('secrets.filters.all'),
      ...KINDS.map(kindLabel),
    ]);
    await expect(choices.first()).toBeChecked();
    await page.keyboard.press('Escape');

    const byKind: Array<[SecretKind, string[]]> = [
      ['personal', ['Alpha details']],
      ['credentials', ['Global login', 'Alpha login']],
      ['card', ['Global card', 'Beta card']],
      ['note', ['Global note']],
    ];
    for (const [kind, titles] of byKind) {
      await secrets.filterByKind(kind);
      await expectListed(secrets, titles);
      await expect(secrets.chip('type', kindLabel(kind))).toBeVisible();
      await expect(secrets.chips.getByRole('listitem')).toHaveCount(1);
      await expect(page).toHaveURL(new RegExp(`\\?type=${kind}$`));
    }

    // "All" lifts it, and the address is the plain one again.
    await secrets.filterByKind('all');
    await expectListed(
      secrets,
      byKind.flatMap(([, titles]) => titles),
    );
    await expect(secrets.chips).toHaveCount(0);
    await expect(page).toHaveURL(/\/secrets$/);
  });

  test("by who it is available to: all of them, those for every session, or one session's own", async ({
    page,
    api,
  }) => {
    const { alpha } = await seedVault(api);
    const secrets = await SecretsPage.open(page);

    // The choices: all, every session, then the sessions that have a secret.
    const choices = await choicesOf(secrets, 'scope');
    await expect(choices).toHaveText([
      t('secrets.scope.all'),
      t('secrets.scope.global'),
      scopeText('alpha'),
      scopeText('beta'),
    ]);
    await expect(choices.first()).toBeChecked();
    await page.keyboard.press('Escape');

    await secrets.filterBy('scope', t('secrets.scope.global'));
    await expectListed(secrets, ['Global login', 'Global card', 'Global note']);
    await expect(
      secrets.chip('scope', t('secrets.scope.everySession')),
    ).toBeVisible();
    await expect(page).toHaveURL(/\?scope=global$/);

    // A session's own: not those for every session too.
    await secrets.filterBy('scope', scopeText('alpha'));
    await expectListed(secrets, ['Alpha details', 'Alpha login']);
    await expect(page).toHaveURL(new RegExp(`\\?scope=${alpha.id}$`));
    await secrets.filterBy('scope', scopeText('beta'));
    await expectListed(secrets, ['Beta card']);

    await secrets.filterBy('scope', t('secrets.scope.all'));
    await expect(secrets.rows).toHaveCount(6);
    await expect(secrets.chips).toHaveCount(0);
  });

  test('a session that has no secret is not offered, and one that has none left stops being', async ({
    page,
    api,
  }) => {
    const [alpha] = await sessionsNamed(api, 'alpha', 'beta');
    await api.createSecret({ ...NOTE, sessionId: alpha.id });
    const secrets = await SecretsPage.open(page);

    // beta has no secret: a list of its own would be empty.
    const choices = await choicesOf(secrets, 'scope');
    await expect(choices).toHaveText([
      t('secrets.scope.all'),
      t('secrets.scope.global'),
      scopeText('alpha'),
    ]);
  });

  test('by both: each filter has its chip, a chip lifts its own, Clear filters lifts both, and a new secret starts as what the list is narrowed to', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    await secrets.filterByKind('credentials');
    await secrets.filterBy('scope', scopeText('alpha'));
    await expectListed(secrets, ['Alpha login']);
    await expect(secrets.chips.getByRole('listitem')).toHaveCount(2);
    await expect(secrets.chip('type', kindLabel('credentials'))).toBeVisible();
    await expect(secrets.chip('scope', scopeText('alpha'))).toBeVisible();

    // A new secret starts as the type and for the session of the filters.
    let dialog = await secrets.openCreate();
    await expect(
      dialog.getByRole('combobox', { name: t('secrets.form.kind') }),
    ).toHaveText(kindLabel('credentials'));
    await expect(secrets.scopeSelect(dialog)).toContainText(scopeText('alpha'));
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();

    // The chip of the type lifts the type alone.
    await secrets.chip('type', kindLabel('credentials')).click();
    await expectListed(secrets, ['Alpha details', 'Alpha login']);
    await expect(secrets.chips.getByRole('listitem')).toHaveCount(1);

    // Narrowed to a type only, a new secret is for every session.
    await secrets.clearAll.click();
    await expect(secrets.chips).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(6);
    await secrets.filterByKind('card');
    dialog = await secrets.openCreate();
    await expect(
      dialog.getByRole('combobox', { name: t('secrets.form.kind') }),
    ).toHaveText(kindLabel('card'));
    await expect(secrets.scopeSelect(dialog)).toContainText(scopeText(null));
  });

  test('says so when the filters leave nothing, and "Show all secrets" lifts them', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    await secrets.filterByKind('note');
    await secrets.filterBy('scope', scopeText('beta'));

    await soon(
      secrets.table.getByRole('heading', {
        level: 2,
        name: t('common.search.noResults'),
      }),
    ).toBeVisible();
    await expect(secrets.table).toContainText(t('common.search.tryAdjusting'));
    await expect(secrets.rows).toHaveCount(0);

    await secrets.table
      .getByRole('button', { name: t('secrets.noMatches.showAll') })
      .click();
    await expect(secrets.chips).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(6);
    await expect(page).toHaveURL(/\/secrets$/);
  });

  test('are kept in the address, so that a link, a reload and the way back keep the view', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);

    // A link written by hand opens the page narrowed, chips and all.
    await page.goto('/secrets?type=card&scope=global');
    await expectListed(secrets, ['Global card']);
    await expect(secrets.chip('type', kindLabel('card'))).toBeVisible();
    await expect(
      secrets.chip('scope', t('secrets.scope.everySession')),
    ).toBeVisible();

    await page.reload();
    await expectListed(secrets, ['Global card']);

    // The way back from another page keeps the view.
    await page
      .getByRole('navigation', { name: t('navigation.aria.main') })
      .getByRole('link', { name: t('navigation.sections.proxies') })
      .click();
    await expect(page).toHaveURL(/\/proxies$/);
    await page.goBack();
    await expectListed(secrets, ['Global card']);

    // A change of the filters replaces the address instead of adding to the
    // history: the way back goes to the page before the link, not to the view
    // the filters had a moment ago.
    await secrets.filterByKind('note');
    await expect(page).toHaveURL(/\?type=note&scope=global$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/secrets$/);
    await expect(secrets.chips).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(6);
  });

  test('the panel has a Clear all of its own, which lifts both filters', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    await secrets.filterByKind('credentials');
    await secrets.filterBy('scope', scopeText('alpha'));
    await expectListed(secrets, ['Alpha login']);

    await secrets.filterButton.click();
    await soon(secrets.filterPanel).toBeVisible();
    await secrets.clearInPanel.click();
    await soon(secrets.filterPanel).toBeHidden();
    await expect(secrets.chips).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(6);
    await expect(page).toHaveURL(/\/secrets$/);
  });

  test('Clear filters is there while a type, a session or a search narrows the list, and not otherwise', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    await expect(secrets.rows).toHaveCount(6);
    await expect(secrets.clearAll).toHaveCount(0);

    await secrets.filterByKind('note');
    await expect(secrets.clearAll).toBeVisible();
    await secrets.filterByKind('all');
    await expect(secrets.clearAll).toHaveCount(0);

    await secrets.filterBy('scope', scopeText('beta'));
    await expect(secrets.clearAll).toBeVisible();
    await secrets.filterBy('scope', t('secrets.scope.all'));
    await expect(secrets.clearAll).toHaveCount(0);

    await secrets.searchFor('alpha');
    await expect(secrets.clearAll).toBeVisible();
    await secrets.clearAll.click();
    await expect(secrets.search).toHaveValue('');
    await expect(secrets.clearAll).toHaveCount(0);
  });

  test('read an address with a part that makes no sense as no filter at all', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    await page.goto('/secrets?type=nonsense&scope=somewhere');
    await expect(secrets.heading).toBeVisible();
    await expect(secrets.rows).toHaveCount(6);
    await expect(secrets.chips).toHaveCount(0);

    // The part that makes sense is kept.
    await page.goto('/secrets?type=note&scope=somewhere');
    await expectListed(secrets, ['Global note']);
  });
});

test.describe('searching the list', () => {
  test('finds a secret by its title, its details, its kind or its session', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);

    const found: Array<[string, string[]]> = [
      ['login', ['Global login', 'Alpha login']],
      // Capitals do not matter.
      ['GLOBAL', ['Global login', 'Global card', 'Global note']],
      // What a row shows of a secret is what a search looks at.
      ['4242', ['Global card', 'Beta card']],
      ['shop.example', ['Global login', 'Alpha login']],
      [kindLabel('note'), ['Global note']],
      [kindLabel('card'), ['Global card', 'Beta card']],
      // A session: by its name.
      ['beta', ['Beta card']],
      ['alpha', ['Alpha details', 'Alpha login']],
    ];
    for (const [query, titles] of found) {
      await secrets.searchFor(query);
      await expectListed(secrets, titles);
    }

    // Searching and narrowing work together.
    await secrets.filterByKind('credentials');
    await secrets.searchFor('alpha');
    await expectListed(secrets, ['Alpha login']);
  });

  test('is kept in the address with the filters, so that a reload and a link keep the view', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);

    await secrets.filterByKind('credentials');
    await secrets.searchFor('alpha');
    await expect(page).toHaveURL(/\?type=credentials&q=alpha$/);
    await expectListed(secrets, ['Alpha login']);

    await page.reload();
    await expect(secrets.search).toHaveValue('alpha');
    await expect(secrets.chip('type', kindLabel('credentials'))).toBeVisible();
    await expectListed(secrets, ['Alpha login']);

    // A link written by hand, and what lifts the search: Clear filters lifts it
    // and the filters with it.
    await page.goto('/secrets?q=beta');
    await expect(secrets.search).toHaveValue('beta');
    await expectListed(secrets, ['Beta card']);
    await secrets.clearAll.click();
    await expect(page).toHaveURL(/\/secrets$/);
    await expect(secrets.search).toHaveValue('');
    await expect(secrets.rows).toHaveCount(6);
  });

  test('never finds a value the list does not show', async ({ page, api }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    for (const hidden of [PASSWORD, CARD_NUMBER, CVC]) {
      await secrets.searchFor(hidden);
      await soon(
        secrets.table.getByRole('heading', {
          name: t('common.search.noResults'),
        }),
      ).toBeVisible();
      await expect(secrets.rows).toHaveCount(0);
    }
  });

  test('says so when nothing matches, and "Clear filters" brings the list back', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    await secrets.searchFor('no such secret');
    await soon(
      secrets.table.getByRole('heading', {
        name: t('common.search.noResults'),
      }),
    ).toBeVisible();
    await expect(secrets.table).toContainText(t('common.search.tryAdjusting'));
    await expect(secrets.rows).toHaveCount(0);

    await secrets.clearAll.click();
    await expect(secrets.search).toHaveValue('');
    await expect(secrets.rows).toHaveCount(6);
    await expect(secrets.footer).toHaveText(showingAll(6));
  });
});

// ---------------------------------------------------------------------------
// A list that follows what happens elsewhere
// ---------------------------------------------------------------------------

test.describe('the list of secrets', () => {
  test('follows what is added, renamed and deleted elsewhere, without a reload', async ({
    page,
    api,
    request,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    await soon(secrets.row(CREDENTIALS.title).row).toBeVisible();

    // An assistant adds one, renames it, deletes it; the page is not touched.
    await api.createSecret(NOTE);
    await eventually(secrets.row(NOTE.title).row).toBeVisible();
    const renamed = await request.patch(`/api/secrets/${created.id}`, {
      data: { title: 'Renamed elsewhere' },
    });
    expect(renamed.ok()).toBe(true);
    await eventually(secrets.row('Renamed elsewhere').row).toBeVisible();
    await expect(secrets.row(CREDENTIALS.title).row).toHaveCount(0);

    await api.deleteSecret(created.id);
    await eventually(secrets.row('Renamed elsewhere').row).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(1);
    await expect(secrets.footer).toHaveText(showingAll(1));
  });

  test('follows what the page itself does at once', async ({ page, api }) => {
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.titleField(dialog).fill('Quick one');
    await secrets.valueField(dialog, startingField('username')).fill('ann');
    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();
    // Well before the list is asked again on its own.
    await soon(secrets.row('Quick one').row).toBeVisible();

    const edit = await secrets.openEdit('Quick one');
    await secrets.titleField(edit).fill('Quick two');
    await secrets.submit(edit, t('common.actions.save')).click();
    await soon(secrets.row('Quick two').row).toBeVisible();
    await expect(secrets.row('Quick one').row).toHaveCount(0);

    const remove = await secrets.openDelete('Quick two');
    await secrets.deleteConfirm(remove).click();
    await soon(
      secrets.table.getByRole('heading', { name: t('secrets.empty.title') }),
    ).toBeVisible();
    expect(await api.secrets()).toEqual([]);
  });

  test('loses the secrets of a session when it is deleted, and keeps the others', async ({
    page,
    api,
  }) => {
    const [alpha, beta] = await sessionsNamed(api, 'alpha', 'beta');
    await api.createSecret({ ...CREDENTIALS, title: 'Global login' });
    await api.createSecret({
      ...PERSONAL,
      title: 'Alpha details',
      sessionId: alpha.id,
    });
    await api.createSecret({ ...CARD, title: 'Beta card', sessionId: beta.id });
    const secrets = await SecretsPage.open(page);
    await expectListed(secrets, ['Global login', 'Alpha details', 'Beta card']);

    // The session goes with its browser profile and its own secrets.
    await api.deleteSession(alpha.id);
    await eventually(secrets.row('Alpha details').row).toHaveCount(0);
    await expectListed(secrets, ['Global login', 'Beta card']);
    expect((await api.secrets()).map(({ title }) => title).sort()).toEqual([
      'Beta card',
      'Global login',
    ]);
    expect((await api.sessions()).map(({ name }) => name)).toEqual(['beta']);

    // The session is not among the choices any more, nor is it in the form.
    await page.reload();
    await expectListed(secrets, ['Global login', 'Beta card']);
    await expect(await choicesOf(secrets, 'scope')).toHaveText([
      t('secrets.scope.all'),
      t('secrets.scope.global'),
      scopeText('beta'),
    ]);
    await page.keyboard.press('Escape');
    const dialog = await secrets.openCreate();
    await secrets.titleField(dialog).fill('Fresh');
    await secrets.scopeSelect(dialog).click();
    await expect(page.getByRole('option')).toHaveText([
      scopeText(null),
      scopeText('beta'),
    ]);
  });

  test('shows a session renamed elsewhere under its new name', async ({
    page,
    api,
    request,
  }) => {
    const [alpha] = await sessionsNamed(api, 'alpha');
    await api.createSecret({ ...CREDENTIALS, sessionId: alpha.id });
    const secrets = await SecretsPage.open(page);
    await soon(secrets.row(CREDENTIALS.title).scope).toContainText('alpha');

    const renamed = await request.patch(`/api/sessions/${alpha.id}`, {
      data: { name: 'gamma' },
    });
    expect(renamed.ok()).toBe(true);
    await eventually(
      secrets.row(CREDENTIALS.title).scope.getByRole('link', { name: 'gamma' }),
    ).toHaveAttribute('href', `/sessions/${alpha.id}`);
    await page.reload();
    await expect(await choicesOf(secrets, 'scope')).toContainText([
      t('secrets.scope.all'),
      t('secrets.scope.global'),
      scopeText('gamma'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

test.describe('from the keyboard', () => {
  test('the title of a secret opens it, and Escape gives the focus back to it', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const { title } = secrets.row(CREDENTIALS.title);

    await title.focus();
    await page.keyboard.press('Enter');
    await secrets.expectOpen(secrets.viewDialog);
    await expect(secrets.viewDialog).toContainText(CREDENTIALS.title);
    await page.keyboard.press('Escape');
    await soon(secrets.viewDialog).toBeHidden();
    await expect(title).toBeFocused();
  });

  test('a row menu opens, moves, chooses and gives the focus back', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    const { menu } = secrets.row(CREDENTIALS.title);
    const view = page.getByRole('menuitem', {
      name: t('secrets.actions.view'),
    });
    const edit = page.getByRole('menuitem', {
      name: t('secrets.actions.edit'),
    });
    const remove = page.getByRole('menuitem', {
      name: t('common.actions.delete'),
    });

    await menu.focus();
    await openMenuWithKeyboard(page, view);
    await page.keyboard.press('ArrowDown');
    await expect(edit).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(remove).toBeHidden();
    await expect(menu).toBeFocused();

    // Edit, with nothing changed, is left with Escape, back to the menu button.
    await openMenuWithKeyboard(page, view);
    await page.keyboard.press('ArrowDown');
    await expect(edit).toBeFocused();
    await page.keyboard.press('Enter');
    await secrets.expectOpen(secrets.editDialog);
    await expect(secrets.titleField(secrets.editDialog)).toHaveValue(
      CREDENTIALS.title,
    );
    await page.keyboard.press('Escape');
    await soon(secrets.editDialog).toBeHidden();
    await expect(menu).toBeFocused();

    // Delete asks, and Enter on the confirmation deletes.
    await openMenuWithKeyboard(page, view);
    await page.keyboard.press('End');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = secrets.deleteDialog(CREDENTIALS.title);
    await secrets.expectOpen(dialog);
    await secrets.deleteConfirm(dialog).focus();
    await page.keyboard.press('Enter');
    await soon(dialog).toBeHidden();
    expect(await api.secrets()).toEqual([]);
  });

  test('a secret is added, with a value revealed, without the mouse', async ({
    page,
    api,
    request,
  }) => {
    const secrets = await SecretsPage.open(page);
    await secrets.addButton.focus();
    await page.keyboard.press('Enter');
    await secrets.expectOpen(secrets.createDialog);
    const dialog = secrets.createDialog;

    // The title has the focus when the form opens.
    await expect(secrets.titleField(dialog)).toBeFocused();
    await page.keyboard.type('Keyboard only');
    await secrets.valueField(dialog, startingField('password')).focus();
    await page.keyboard.type(PASSWORD);

    // The eye is a button like any other: Space shows the value, and again hides it.
    const password = secrets.valueField(dialog, startingField('password'));
    const show = secrets.valueButton(dialog, 'show', startingField('password'));
    await show.focus();
    await page.keyboard.press('Space');
    await expect(password).toHaveCSS('-webkit-text-security', 'none');
    await secrets
      .valueButton(dialog, 'hide', startingField('password'))
      .focus();
    await page.keyboard.press('Space');
    await expect(password).toHaveCSS('-webkit-text-security', 'disc');

    // Enter in a field saves, as it does anywhere.
    await secrets.valueField(dialog, startingField('username')).focus();
    await page.keyboard.type('ann');
    await page.keyboard.press('Enter');
    await soon(dialog).toBeHidden();
    await soon(secrets.row('Keyboard only').row).toBeVisible();
    await expect(secrets.addButton).toBeFocused();
    const [summary] = await api.secrets();
    expect((await storedSecret(request, summary.id)).fields).toEqual([
      { label: 'Username', value: 'ann', hidden: false },
      { label: 'Password', value: PASSWORD, hidden: true },
    ]);
  });

  test('after a deletion the focus stays on the table: on the next row, or on Add when none is left', async ({
    page,
    api,
  }) => {
    for (const title of ['One', 'Two', 'Three']) {
      await api.createSecret({ ...NOTE, title });
    }
    const secrets = await SecretsPage.open(page);
    const view = page.getByRole('menuitem', {
      name: t('secrets.actions.view'),
    });
    const remove = page.getByRole('menuitem', {
      name: t('common.actions.delete'),
    });
    const deleteWithKeyboard = async (title: string) => {
      await secrets.row(title).menu.focus();
      await openMenuWithKeyboard(page, view);
      await page.keyboard.press('End');
      await expect(remove).toBeFocused();
      await page.keyboard.press('Enter');
      const dialog = secrets.deleteDialog(title);
      await secrets.expectOpen(dialog);
      await secrets.deleteConfirm(dialog).focus();
      await page.keyboard.press('Enter');
      await soon(dialog).toBeHidden();
      await expect(secrets.row(title).row).toHaveCount(0);
    };

    // The newest comes first: Three, Two, One.
    await deleteWithKeyboard('Two');
    await expect(secrets.row('One').menu).toBeFocused();
    await deleteWithKeyboard('Three');
    await expect(secrets.row('One').menu).toBeFocused();
    await deleteWithKeyboard('One');
    await expect(secrets.addButton).toBeFocused();
  });

  test('who it is for is chosen by typing in the list of sessions, with the arrows and Enter; Escape closes the list alone', async ({
    page,
    api,
  }) => {
    await sessionsNamed(api, 'alpha', 'beta');
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.expectOpen(dialog);
    await secrets.titleField(dialog).fill('Keyboard scope');

    const select = secrets.scopeSelect(dialog);
    const list = page.getByRole('dialog', { name: t('secrets.scope.label') });
    const search = list.getByRole('combobox', {
      name: t('secrets.scope.search'),
    });
    await select.focus();
    await page.keyboard.press('Enter');
    // The list opens on its search box.
    await expect(search).toBeFocused();
    await page.keyboard.type('bet');
    await expect(list.getByRole('option')).toHaveText([scopeText('beta')]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await soon(list).toBeHidden();
    await expect(select).toContainText(scopeText('beta'));
    await expect(select).toBeFocused();

    // Escape closes the list, not the form behind it.
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await soon(list).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(select).toBeFocused();
    await expect(select).toContainText(scopeText('beta'));
  });

  test('the filters are used with the keyboard alone: Enter opens the panel, the arrows choose, Escape closes it, Enter on a chip lifts it', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    await api.createSecret(CARD);
    const secrets = await SecretsPage.open(page);
    const panel = secrets.filterPanel;
    const type = t('secrets.filters.type');

    await secrets.filterButton.focus();
    await page.keyboard.press('Enter');
    await soon(panel).toBeVisible();
    // The panel opens on its first group, which Enter opens.
    const section = panel.getByRole('button', { name: type, exact: true });
    await expect(section).toBeFocused();
    await page.keyboard.press('Enter');
    const choices = panel
      .getByRole('radiogroup', { name: type })
      .getByRole('radio');
    await page.keyboard.press('Tab');
    await expect(choices.first()).toBeFocused();

    // The arrows move between the choices and choose as they go.
    await page.keyboard.press('ArrowDown');
    await expect(choices.nth(1)).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(choices.nth(2)).toBeChecked();
    await expectListed(secrets, [CREDENTIALS.title]);
    await page.keyboard.press('ArrowDown');
    await expect(choices.nth(3)).toBeChecked();
    await expectListed(secrets, [CARD.title]);

    // Escape closes the panel and gives the focus back to its button.
    await page.keyboard.press('Escape');
    await soon(panel).toBeHidden();
    await expect(secrets.filterButton).toBeFocused();

    // The chip of the filter in force lifts it.
    const chip = secrets.chip('type', kindLabel('card'));
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(secrets.chips).toHaveCount(0);
    await expectListed(secrets, [CREDENTIALS.title, CARD.title]);
  });
});

// ---------------------------------------------------------------------------
// Hidden values stay out of the page
// ---------------------------------------------------------------------------

test.describe('a hidden value', () => {
  test('is on the page only where it is revealed, and never in what the API lists', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    await api.createSecret(CARD);
    const named = {
      'the password': PASSWORD,
      'the card number': CARD_NUMBER,
      'the digits of the card number': CARD_NUMBER.replaceAll(' ', ''),
      'the CVC': CVC,
    };
    const secrets = await SecretsPage.open(page);
    await expect(secrets.rows).toHaveCount(2);

    // The list: a card shows its last four digits, a password nothing.
    await expect(secrets.row(CARD.title).details).toHaveText(
      '•••• 4242 · Ann Example · 12/30',
    );
    await expect(secrets.row(CREDENTIALS.title).details).toHaveText(
      'https://shop.example · ann',
    );
    expect(await leaksOf(page, named)).toEqual([]);

    // The details: "Hidden" until the person asks, and again once they hide it.
    const details = await secrets.openView(CARD.title);
    expect(await leaksOf(page, named)).toEqual([]);
    const label = startingField('cvc');
    await secrets.valueButton(details, 'show', label).click();
    await expect(details).toContainText(CVC);
    await secrets.valueButton(details, 'hide', label).click();
    await expect(details).not.toContainText(CVC);
    expect(await leaksOf(page, named)).toEqual([]);
    await page.keyboard.press('Escape');
    await soon(details).toBeHidden();

    // The form holds the values to change them, as dots, never as text.
    const form = await secrets.openEdit(CREDENTIALS.title);
    await secrets.valueButton(form, 'show', startingField('password')).click();
    expect(await leaksOf(page, named, ['markup', 'text'])).toEqual([]);

    // The API's list has no values; neither of the page's requests had.
    const listed = JSON.stringify(await api.secrets());
    for (const value of Object.values(named)) {
      expect(listed).not.toContain(value);
    }
    expect(listed).not.toContain('"fields"');
  });
});

// ---------------------------------------------------------------------------
// When the backend fails
// ---------------------------------------------------------------------------

test.describe('when a request fails', () => {
  test('adding is told in a notice, and the form stays with its draft for another try', async ({
    page,
    api,
  }) => {
    const fault = await failRequests(
      page,
      (url, method) => method === 'POST' && url.pathname === '/api/secrets',
    );
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    const submit = secrets.submit(dialog, t('secrets.form.createSubmit'));
    await secrets.titleField(dialog).fill('Example shop');
    await secrets.valueField(dialog, startingField('username')).fill('ann');
    await secrets.valueField(dialog, startingField('password')).fill(PASSWORD);
    await submit.click();

    await soon(secrets.toast(t('secrets.toasts.createFailed'))).toBeVisible();
    await expect(secrets.toast(t('errors.fallback'))).toBeVisible();
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);
    // No refusal of the values: nothing is said on top of the form, the draft stays.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(secrets.titleField(dialog)).toHaveValue('Example shop');
    await expect(
      secrets.valueField(dialog, startingField('password')),
    ).toHaveValue(PASSWORD);
    await expect(submit).toBeEnabled();
    expect(await api.secrets()).toEqual([]);

    fault.heal();
    await submit.click();
    await soon(dialog).toBeHidden();
    await soon(secrets.row('Example shop').row).toBeVisible();
  });

  test('a refusal of the values that the form did not foresee is told on top of it, and the draft stays', async ({
    page,
    api,
  }) => {
    const fault = await failRequests(
      page,
      (url, method) => method === 'POST' && url.pathname === '/api/secrets',
      {
        status: 422,
        error: 'invalid_secret',
        message: 'Fill in at least one value.',
      },
    );
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openCreate();
    await secrets.titleField(dialog).fill('Example shop');
    await secrets.valueField(dialog, startingField('username')).fill('ann');
    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();

    // The app words the refusal from its code, not from the backend's sentence.
    await soon(dialog.getByRole('alert')).toHaveText(
      t('errors.invalid_secret'),
    );
    await expect(secrets.toast(t('secrets.toasts.createFailed'))).toHaveCount(
      0,
    );
    await expect(secrets.titleField(dialog)).toHaveValue('Example shop');
    expect(await api.secrets()).toEqual([]);

    // The refusal is withdrawn with the next save.
    fault.heal();
    await secrets.submit(dialog, t('secrets.form.createSubmit')).click();
    await soon(dialog).toBeHidden();
    await soon(secrets.row('Example shop').row).toBeVisible();
  });

  test('saving is told in a notice, and the form stays for another try', async ({
    page,
    api,
    request,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const fault = await failRequests(
      page,
      (url, method) =>
        method === 'PATCH' && url.pathname === `/api/secrets/${created.id}`,
    );
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openEdit(CREDENTIALS.title);
    await secrets.titleField(dialog).fill('Renamed');
    await secrets.submit(dialog, t('common.actions.save')).click();

    await soon(secrets.toast(t('secrets.toasts.saveFailed'))).toBeVisible();
    await expect(secrets.toast(t('errors.fallback'))).toBeVisible();
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(secrets.titleField(dialog)).toHaveValue('Renamed');
    expect((await storedSecret(request, created.id)).title).toBe(
      CREDENTIALS.title,
    );

    fault.heal();
    await secrets.submit(dialog, t('common.actions.save')).click();
    await soon(dialog).toBeHidden();
    await soon(secrets.row('Renamed').row).toBeVisible();
  });

  test('deleting is told in a notice, and the question stays', async ({
    page,
    api,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const fault = await failRequests(
      page,
      (url, method) =>
        method === 'DELETE' && url.pathname === `/api/secrets/${created.id}`,
    );
    const secrets = await SecretsPage.open(page);
    const dialog = await secrets.openDelete(CREDENTIALS.title);
    const confirm = secrets.deleteConfirm(dialog);
    await confirm.click();

    await soon(secrets.toast(t('secrets.toasts.deleteFailed'))).toBeVisible();
    await expect(secrets.toast(t('errors.fallback'))).toBeVisible();
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(confirm).toBeEnabled();
    expect(await api.secrets()).toHaveLength(1);

    fault.heal();
    await confirm.click();
    await soon(dialog).toBeHidden();
    expect(await api.secrets()).toEqual([]);
  });

  test('opening the details is told in the dialog, with a way to ask again', async ({
    page,
    api,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const fault = await failRequests(
      page,
      (url, method) =>
        method === 'GET' && url.pathname === `/api/secrets/${created.id}`,
    );
    const secrets = await SecretsPage.open(page);
    await secrets.row(CREDENTIALS.title).title.click();
    await soon(secrets.viewDialog).toBeVisible();

    // The dialog names what could not be read; the cause is only added where
    // trying again would not mend it, and this one it would.
    const alert = secrets.viewDialog.getByRole('alert');
    await soon(alert).toContainText(t('secrets.loadFailed'));
    await expect(alert).not.toContainText(t('errors.fallback'));
    await expect(page.getByText(fault.message)).toHaveCount(0);
    // Nothing of the secret is shown, and nothing that looks like its values.
    await expect(secrets.viewDialog).not.toContainText(PASSWORD);

    fault.heal();
    await secrets.viewDialog
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(secrets.viewDialog).toContainText('https://shop.example');
    await expect(secrets.viewDialog.getByRole('alert')).toHaveCount(0);
  });

  test('waits for the whole secret before the form can be saved, and says so', async ({
    page,
    api,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    // The answer for the one secret is held back until the test lets it go.
    const release = Promise.withResolvers<void>();
    await page.route(
      (url) => url.pathname === `/api/secrets/${created.id}`,
      async (route) => {
        await release.promise;
        await route.fallback();
      },
    );
    const secrets = await SecretsPage.open(page);
    await secrets.chooseInRowMenu(CREDENTIALS.title, t('secrets.actions.edit'));

    // The frame of the form is there, with what the list knows of the secret,
    // and Save is out of reach; the values are not there yet.
    const dialog = secrets.editDialog;
    await soon(dialog).toBeVisible();
    await expect(dialog).toContainText(kindLabel('credentials'));
    await expect(
      secrets.submit(dialog, t('common.actions.save')),
    ).toBeDisabled();
    await expect(
      secrets.valueField(dialog, startingField('password')),
    ).toHaveCount(0);

    release.resolve();
    await expect(
      secrets.valueField(dialog, startingField('password')),
    ).toHaveValue(PASSWORD);
    await expect(secrets.titleField(dialog)).toHaveValue(CREDENTIALS.title);
  });

  test('opening the form is told in the dialog when the secret cannot be read, with a way to ask again', async ({
    page,
    api,
  }) => {
    const created = await api.createSecret(CREDENTIALS);
    const fault = await failRequests(
      page,
      (url, method) =>
        method === 'GET' && url.pathname === `/api/secrets/${created.id}`,
    );
    const secrets = await SecretsPage.open(page);
    await secrets.chooseInRowMenu(CREDENTIALS.title, t('secrets.actions.edit'));
    const dialog = secrets.editDialog;
    const alert = dialog.getByRole('alert');
    await soon(alert).toContainText(t('secrets.loadFailed'));
    await expect(alert).not.toContainText(t('errors.fallback'));
    await expect(
      secrets.submit(dialog, t('common.actions.save')),
    ).toBeDisabled();

    fault.heal();
    await dialog
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await expect(
      secrets.valueField(dialog, startingField('password')),
    ).toHaveValue(PASSWORD);
  });
});

test.describe('when the backend cannot be reached', () => {
  /**
   * A vault that could not be read at all is named in place of the table, in
   * the page's own words and with its own way to try again: not the library's
   * generic page, with the link to the support of another site, and not "No
   * secrets yet", which would say that there are none. It does not say that
   * what is listed may be out of date: nothing is.
   */
  async function expectUnread(
    page: Page,
    secrets: SecretsPage,
  ): Promise<Locator> {
    const failure = secrets.region
      .getByRole('alert')
      .filter({ hasText: t('secrets.listFailed') });
    await soon(failure).toBeVisible();
    await expect(failure).not.toContainText(t('secrets.refreshFailed'));
    await expect(
      page.getByRole('heading', {
        name: t('common.errors.somethingWentWrong'),
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: t('common.errors.contactSupport') }),
    ).toHaveCount(0);
    await expect(
      secrets.region.getByRole('heading', { name: t('secrets.empty.title') }),
    ).toHaveCount(0);
    await expect(secrets.table).toHaveCount(0);
    return failure;
  }

  test('on opening, the page says the secrets could not be loaded and "Try again" brings them', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    const cut = await cutOff(page);
    const secrets = await SecretsPage.open(page);
    const failure = await expectUnread(page, secrets);
    // The page's banner says why the server cannot be reached; the sentence does not.
    await expect(failure).not.toContainText(t('errors.network'));

    await cut.heal();
    await failure
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(secrets.row(CREDENTIALS.title).row).toBeVisible();
    await expect(failure).toHaveCount(0);
    // The button that was pressed is gone: the keyboard stays on the page's part.
    await expect(secrets.region).toBeFocused();
  });

  test('on opening, an error of the server is told in the same words', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    const fault = await failRequests(
      page,
      (url, method) => method === 'GET' && url.pathname === '/api/secrets',
    );
    const secrets = await SecretsPage.open(page);
    const failure = await expectUnread(page, secrets);
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);

    fault.heal();
    await failure
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(secrets.row(CREDENTIALS.title).row).toBeVisible();
    await expect(failure).toHaveCount(0);
  });

  test('on opening, a refusal that trying again would not mend is told with its cause', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    const fault = await failRequests(
      page,
      (url, method) => method === 'GET' && url.pathname === '/api/secrets',
      { status: 403, error: 'forbidden_host', message: 'Forbidden host' },
    );
    const secrets = await SecretsPage.open(page);
    const failure = await expectUnread(page, secrets);
    await expect(failure).toContainText(t('errors.forbidden_host'));

    fault.heal();
    await failure
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(secrets.row(CREDENTIALS.title).row).toBeVisible();
  });

  test('while the secrets are shown, the rows stay and the page says the connection is lost', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    await api.createSecret(NOTE);
    const secrets = await SecretsPage.open(page);
    await expect(secrets.rows).toHaveCount(2);
    const lost = page
      .getByRole('alert')
      .filter({ hasText: t('banners.connection.lost') });
    // Above the rows, what the failure means for the list, with the retry; the
    // page's banner says why, so the sentence does not.
    const outOfDate = page
      .getByRole('alert')
      .filter({ hasText: t('secrets.refreshFailed') });

    const cut = await cutOff(page);
    await eventually(lost).toBeVisible();
    await eventually(outOfDate).toBeVisible();
    await expect(outOfDate).not.toContainText(t('errors.network'));
    await expect(secrets.rows).toHaveCount(2);

    await cut.heal();
    await outOfDate
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(outOfDate).toHaveCount(0);
    await eventually(lost).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(2);
  });

  test('while the secrets are shown, a refusal that trying again would not mend is told with its cause', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    const secrets = await SecretsPage.open(page);
    await expect(secrets.rows).toHaveCount(1);
    const outOfDate = page
      .getByRole('alert')
      .filter({ hasText: t('secrets.refreshFailed') });

    // The page was opened at an address the server does not answer.
    const fault = await failRequests(
      page,
      (url, method) => method === 'GET' && url.pathname === '/api/secrets',
      {
        status: 403,
        error: 'forbidden_host',
        message: 'Forbidden host',
      },
    );
    await eventually(outOfDate).toBeVisible();
    await expect(outOfDate).toContainText(t('errors.forbidden_host'));
    await expect(secrets.rows).toHaveCount(1);

    fault.heal();
    await outOfDate
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(outOfDate).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

test.describe('accessibility', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the list, its states and its dialogs pass the audit in ${scheme} mode`, async ({
      page,
      api,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const [alpha] = await sessionsNamed(api, 'alpha');
      await api.createSecret({
        ...CREDENTIALS,
        fields: [
          ...CREDENTIALS.fields,
          { label: 'Backup code', value: 'ABC-123' },
        ],
      });
      await api.createSecret({ ...CARD, sessionId: alpha.id });
      await api.createSecret({
        ...NOTE,
        fields: [{ label: 'Note', value: 'remember the milk\nand the eggs' }],
      });
      await api.createSecret({
        ...PERSONAL,
        fields: [
          ...PERSONAL.fields,
          { label: 'Address', value: '1 Main Street\nSpringfield' },
        ],
      });
      const secrets = await SecretsPage.open(page);
      await expect(secrets.rows).toHaveCount(4);
      const audit = async (): Promise<void> => {
        await untilStill(page);
        expect(await violationsOf(page)).toEqual([]);
      };
      // Leaving a form that was changed asks first: the answer is yes.
      answerNativeQuestions(page, true);

      await audit();
      // The panel of the filters, open on both its groups, and what a filter leaves.
      await secrets.filterButton.click();
      await soon(secrets.filterPanel).toBeVisible();
      for (const group of ['type', 'scope'] as const) {
        const title = t(`secrets.filters.${group}`);
        await secrets.filterPanel
          .getByRole('button', { name: title, exact: true })
          .click();
        await soon(
          secrets.filterPanel.getByRole('radiogroup', { name: title }),
        ).toBeVisible();
      }
      await audit();
      await page.keyboard.press('Escape');
      await soon(secrets.filterPanel).toBeHidden();
      await secrets.filterBy('scope', scopeText('alpha'));
      await secrets.filterByKind('note');
      await soon(
        secrets.table.getByRole('heading', {
          name: t('common.search.noResults'),
        }),
      ).toBeVisible();
      await audit();
      await secrets.table
        .getByRole('button', { name: t('secrets.noMatches.showAll') })
        .click();
      await expect(secrets.rows).toHaveCount(4);

      // The details, hidden and shown.
      const details = await secrets.openView(CREDENTIALS.title);
      await secrets.expectOpen(details);
      await audit();
      await secrets
        .valueButton(details, 'show', startingField('password'))
        .click();
      await audit();

      // The form that Edit hands over to, with an error beside the title.
      await details
        .getByRole('button', { name: t('secrets.actions.edit') })
        .click();
      await secrets.expectOpen(secrets.editDialog);
      await expect(secrets.titleField(secrets.editDialog)).toHaveValue(
        CREDENTIALS.title,
      );
      await audit();
      await secrets.titleField(secrets.editDialog).fill('');
      await secrets
        .submit(secrets.editDialog, t('common.actions.save'))
        .click();
      await soon(secrets.editDialog.getByRole('alert')).toBeVisible();
      await audit();
      await secrets.editDialog
        .getByRole('button', { name: t('common.actions.cancel') })
        .click();
      await soon(secrets.editDialog).toBeHidden();
      await page.keyboard.press('Escape');
      await soon(secrets.viewDialog).toBeHidden();

      // The form that adds a secret, with a row of its own that lacks a label.
      const create = await secrets.openCreate();
      await secrets.expectOpen(create);
      await audit();
      await secrets.titleField(create).fill('Audit');
      await secrets.addFieldButton(create).click();
      await secrets.customValue(create, 0).fill('x');
      await secrets.submit(create, t('secrets.form.createSubmit')).click();
      await soon(create.getByRole('alert')).toBeVisible();
      await audit();
      await create
        .getByRole('button', { name: t('common.actions.cancel') })
        .click();
      await soon(create).toBeHidden();

      // The question before a deletion.
      const remove = await secrets.openDelete(NOTE.title);
      await secrets.expectOpen(remove);
      await audit();
    });
  }

  test('a vault that could not be read passes the audit in both modes', async ({
    page,
    api,
  }) => {
    await api.createSecret(CREDENTIALS);
    await cutOff(page);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const secrets = await SecretsPage.open(page);
      await soon(
        secrets.region
          .getByRole('alert')
          .filter({ hasText: t('secrets.listFailed') }),
      ).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page), scheme).toEqual([]);
    }
  });

  test('the empty vault passes the audit in both modes', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const secrets = await SecretsPage.open(page);
      await soon(
        secrets.table.getByRole('heading', { name: t('secrets.empty.title') }),
      ).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page), scheme).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// The page as a whole
// ---------------------------------------------------------------------------

test.describe('the page', () => {
  test('is reached from the navigation and is the current page; back and forward return to it', async ({
    page,
    api,
  }) => {
    await api.createSecret(NOTE);
    const secrets = await SecretsPage.open(page);
    const navigation = page.getByRole('navigation', {
      name: t('navigation.aria.main'),
    });
    const here = navigation.getByRole('link', {
      name: t('navigation.sections.secrets'),
    });
    const proxies = navigation.getByRole('link', {
      name: t('navigation.sections.proxies'),
    });
    await expect(here).toHaveAttribute('aria-current', 'page');
    await expect(proxies).not.toHaveAttribute('aria-current', 'page');

    await proxies.click();
    await expect(page).toHaveURL(/\/proxies$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/secrets$/);
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.secrets')));
    await soon(secrets.row(NOTE.title).row).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/proxies$/);
  });

  test('shows a title, a label and a value as text, whatever they look like', async ({
    page,
    api,
  }) => {
    const markup = '<img src=x onerror=__pwned=1>';
    const script = '<script>__pwned=1</script>';
    await api.createSecret({
      kind: 'credentials',
      title: markup,
      fields: [
        { label: 'Username', value: script },
        { label: '<b>bold</b>', value: markup },
      ],
    });
    const secrets = await SecretsPage.open(page);

    // The list: the title and the details are words.
    const row = secrets.row(markup);
    await soon(row.row).toBeVisible();
    await expect(row.details).toHaveText(`${script} · ${markup}`);
    await expect(row.row.locator('img, script')).toHaveCount(0);

    // The details, the form and the question before a deletion.
    const details = await secrets.openView(markup);
    await expect(details).toContainText(script);
    await expect(details).toContainText('<b>bold</b>');
    await expect(details.locator('img, script, b')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await soon(details).toBeHidden();
    const form = await secrets.openEdit(markup);
    await expect(
      secrets.valueField(form, startingField('username')),
    ).toHaveValue(script);
    await form
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(form).toBeHidden();
    const remove = await secrets.openDelete(markup);
    await expect(remove.locator('img, script')).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, '__pwned')),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The width of the window
// ---------------------------------------------------------------------------

test.describe('the table', () => {
  test('keeps its columns in a laptop window of 1024 pixels', async ({
    page,
    api,
  }) => {
    await api.createSecret(NOTE);
    await page.setViewportSize({ width: 1024, height: 768 });
    const secrets = await SecretsPage.open(page);
    await expect(secrets.table.getByRole('columnheader')).toHaveCount(6);
    await expect(secrets.row(NOTE.title).row.getByRole('cell')).toHaveCount(6);
  });

  test('has its columns again when the window grows, and one row per secret when it shrinks', async ({
    page,
    api,
  }) => {
    await api.createSecret(NOTE);
    await page.setViewportSize({ width: 1280, height: 800 });
    const secrets = await SecretsPage.open(page);
    await expect(secrets.table.getByRole('columnheader')).toHaveCount(6);

    await page.setViewportSize({ width: 700, height: 800 });
    await expect(secrets.table.getByRole('columnheader')).toHaveCount(2);
    await expect(secrets.row(NOTE.title).row.getByRole('cell')).toHaveCount(2);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(secrets.table.getByRole('columnheader')).toHaveCount(6);
  });
});

// ---------------------------------------------------------------------------
// The width of a desktop, in the longer languages
// ---------------------------------------------------------------------------

const LOCALE = { de: 'de-DE', fr: 'fr-FR' } as const;

test.describe('the age of a secret', () => {
  // The narrowest window that still has the table, a laptop, a desktop and a
  // large screen: the table shares the width out differently at each (the title
  // and "Available to" grow from 1240 pixels of table), and the age must have
  // its room at all of them.
  for (const width of [1024, 1280, 1440, 1920]) {
    for (const language of ['de', 'fr'] as const) {
      test.describe(`in ${language} at ${width} pixels`, () => {
        test.use({
          locale: LOCALE[language],
          viewport: { width, height: 900 },
        });

        test('is read whole in its cell, and clear of the menu of its row', async ({
          page,
          browser,
          api,
        }) => {
          await api.createSecret(NOTE);
          const english = await englishAge(browser, NOTE.title);
          await page.goto('/secrets');
          const age = ageCell(page, NOTE.title);
          await expect(age).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
          // Measured in the words of its own language, not those it paints first.
          await expect(age).not.toHaveText(english);

          // What a fresh change reads is the longest of what an age can read.
          const { text, room, menu } = await ageOf(page, NOTE.title);
          expect(
            text,
            'the age ends inside the room of its cell',
          ).toBeLessThanOrEqual(room);
          expect(
            text,
            'the age ends before the menu of the row',
          ).toBeLessThanOrEqual(menu);
        });
      });
    }
  }
});

// ---------------------------------------------------------------------------
// On a phone
// ---------------------------------------------------------------------------

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a secret is a line with what it is and for whom, and the menu and the forms are within reach', async ({
    page,
    api,
  }) => {
    const [alpha] = await sessionsNamed(api, 'alpha');
    await api.createSecret({ ...CREDENTIALS, sessionId: alpha.id });
    const secrets = await SecretsPage.open(page);
    const row = secrets.row(CREDENTIALS.title);
    await soon(row.row).toBeVisible();

    // Two columns: the title, with the kind and the session under it, and the menu.
    await expect(secrets.table.getByRole('columnheader')).toHaveCount(2);
    await expect(row.row.getByRole('cell').first()).toContainText(
      summaryText('credentials', 'alpha'),
    );
    await expect(row.menu).toBeInViewport();

    // The form is as wide as the screen and its buttons stay in reach.
    const dialog = await secrets.openCreate();
    await secrets.expectOpen(dialog);
    await secrets.titleField(dialog).fill('From a phone');
    await secrets.valueField(dialog, startingField('username')).fill('ann');
    const submit = secrets.submit(dialog, t('secrets.form.createSubmit'));
    await expect(submit).toBeInViewport();
    await expect(
      dialog.getByRole('button', { name: t('common.actions.cancel') }),
    ).toBeInViewport();
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await submit.click();
    await soon(secrets.row('From a phone').row).toBeVisible();
  });

  test('the chips lift the filters: the button that lifts them all is for wider screens', async ({
    page,
    api,
  }) => {
    await seedVault(api);
    const secrets = await SecretsPage.open(page);
    await page.goto('/secrets?type=note');
    await expectListed(secrets, ['Global note']);
    const chip = secrets.chip('type', kindLabel('note'));
    await expect(chip).toBeVisible();
    await expect(secrets.clearAll).toBeHidden();

    await chip.click();
    await expect(secrets.chips).toHaveCount(0);
    await expect(secrets.rows).toHaveCount(6);
  });

  test.describe('with a finger', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('a secret is added, read with its hidden value and deleted by tapping alone', async ({
      page,
    }) => {
      const secrets = await SecretsPage.open(page);
      expect(
        await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
      ).toBe(true);

      // Add: the button, the form, the button that saves.
      await secrets.addButton.tap();
      const form = secrets.createDialog;
      await soon(form).toBeVisible();
      await secrets.titleField(form).fill('From a phone');
      await secrets.valueField(form, startingField('username')).fill('ann');
      await secrets.valueField(form, startingField('password')).fill(PASSWORD);
      await secrets.submit(form, t('secrets.form.createSubmit')).tap();
      const row = secrets.row('From a phone');
      await soon(row.row).toBeVisible();

      // Read: the password stays hidden until it is asked for, and hides again.
      await row.title.tap();
      const details = secrets.viewDialog;
      await soon(details).toBeVisible();
      const label = startingField('password');
      await expect(details).not.toContainText(PASSWORD);
      await secrets.valueButton(details, 'show', label).tap();
      await expect(details).toContainText(PASSWORD);
      await secrets.valueButton(details, 'hide', label).tap();
      await expect(details).not.toContainText(PASSWORD);
      await details.getByRole('button', { name: t('common.aria.close') }).tap();
      await soon(details).toBeHidden();

      // Delete: the menu, the question, the confirmation.
      await row.menu.tap();
      await page
        .getByRole('menuitem', { name: t('common.actions.delete') })
        .tap();
      const question = secrets.deleteDialog('From a phone');
      await soon(question).toBeVisible();
      await secrets.deleteConfirm(question).tap();
      await soon(question).toBeHidden();
      await soon(
        secrets.table.getByRole('heading', { name: t('secrets.empty.title') }),
      ).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------
// A vault of many secrets
// ---------------------------------------------------------------------------

test.describe('a vault of 60 secrets', () => {
  const COUNT = 60;
  // Oldest first, as they are added; the table lists the newest first.
  const TITLES = Array.from(
    { length: COUNT },
    (_, index) => `Secret ${String(index + 1).padStart(2, '0')}`,
  );
  // Every other one is a note, the rest are credentials.
  const kindOf = (index: number): SecretKind =>
    index % 2 === 0 ? 'note' : 'credentials';

  test.beforeEach(async ({ api }) => {
    for (const [index, title] of TITLES.entries()) {
      await api.createSecret({
        kind: kindOf(index),
        title,
        fields: [
          {
            label: kindOf(index) === 'note' ? 'Note' : 'Username',
            value: `value ${index + 1}`,
          },
        ],
      });
    }
  });

  test('is shown in windows as the table scrolls, newest first, with none lost or repeated', async ({
    page,
  }) => {
    const secrets = await SecretsPage.open(page);
    await soon(secrets.rows.first()).toBeVisible();
    await expect(secrets.footer).not.toHaveText(showingAll(COUNT));
    expect((await secrets.titles())[0]).toBe(TITLES.at(-1));

    const { seen, drawnTwice } = await secrets.scrollThrough(
      COUNT,
      TITLES.at(-1) ?? '',
    );
    expect(drawnTwice).toEqual([]);
    expect(seen).toEqual(TITLES.toReversed());
    await expect(secrets.footer).toHaveText(showingAll(COUNT));
  });

  test('is narrowed and searched as a whole, not by the window that is drawn', async ({
    page,
  }) => {
    const secrets = await SecretsPage.open(page);
    await soon(secrets.rows.first()).toBeVisible();
    expect(await secrets.titles()).not.toContain(TITLES[0]);

    // The oldest is far beyond the first window.
    await secrets.searchFor(TITLES[0]);
    await expectListed(secrets, [TITLES[0]]);

    // Half of them are notes, and all of those are found, newest first.
    await secrets.clearAll.click();
    await secrets.filterByKind('note');
    const notes = TITLES.filter((_, index) => kindOf(index) === 'note');
    const { seen } = await secrets.scrollThrough(
      notes.length,
      notes.at(-1) ?? '',
    );
    expect(seen).toEqual(notes.toReversed());
  });
});

// ---------------------------------------------------------------------------
// In another language
// ---------------------------------------------------------------------------

for (const language of ['de', 'fr'] as const) {
  test.describe(`in ${language}`, () => {
    test.use({ locale: LOCALE[language] });

    test('the page, its toolbar and its table are worded in the language of the browser', async ({
      page,
      api,
    }) => {
      const words = tIn[language];
      await api.createSecret(NOTE);
      await page.goto('/secrets');
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: words('navigation.sections.secrets'),
        }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await expect(page).toHaveTitle(
        tabTitle(words('navigation.sections.secrets')),
      );

      const region = page.getByRole('region', {
        name: words('secrets.table.caption'),
      });
      await expect(
        region.getByRole('button', { name: words('secrets.actions.add') }),
      ).toBeVisible();
      await expect(
        region.getByRole('button', {
          name: words('common.labels.filter'),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        region.getByRole('textbox', {
          name: words('secrets.table.searchPlaceholder'),
        }),
      ).toBeVisible();
      await expect(
        region.getByRole('button', {
          name: fill(words('secrets.table.actionsFor'), { title: NOTE.title }),
        }),
      ).toBeVisible();
    });

    test('the button that lifts the filters says so, and is not the library\'s "Clear all"', async ({
      page,
      api,
    }) => {
      const words = tIn[language];
      await api.createSecret(NOTE);
      await page.goto('/secrets?type=note');
      const region = page.getByRole('region', {
        name: words('secrets.table.caption'),
      });

      // The library's own words for it read as deleting every secret in German.
      await expect(
        region.getByRole('button', { name: words('secrets.filters.clearAll') }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await expect(
        region.getByRole('button', { name: words('common.actions.clearAll') }),
      ).toHaveCount(0);
      const chip = fill(words('secrets.filters.chip'), {
        filter: words('secrets.filters.type'),
        value: words('secrets.kinds.note'),
      });
      await expect(
        region.getByRole('button', {
          name: fill(words('secrets.filters.remove'), { chip }),
        }),
      ).toBeVisible();
    });

    test('the question before a deletion names what it deletes on its button', async ({
      page,
      api,
    }) => {
      const words = tIn[language];
      await api.createSecret(NOTE);
      await page.goto('/secrets');
      const region = page.getByRole('region', {
        name: words('secrets.table.caption'),
      });
      await region
        .getByRole('button', {
          name: fill(words('secrets.table.actionsFor'), { title: NOTE.title }),
        })
        .click({ timeout: TIMEOUT.FIRST_PAINT });
      await page
        .getByRole('menuitem', { name: words('common.actions.delete') })
        .click();

      const question = page.getByRole('dialog', {
        name: fill(words('secrets.delete.title'), { title: NOTE.title }),
      });
      const confirm = question.getByRole('button', {
        name: words('secrets.delete.confirm'),
        exact: true,
      });
      await expect(confirm).toBeVisible();
      await confirm.click();
      await expect(question).toBeHidden();
      await expect(
        region.getByRole('heading', {
          level: 2,
          name: words('secrets.empty.title'),
        }),
      ).toBeVisible();
    });
  });
}
