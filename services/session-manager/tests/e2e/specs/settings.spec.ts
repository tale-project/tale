import type { Locator, Page, Route } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { fill, literally, t } from '../helpers/i18n';
import { fakeTabTitle } from '../helpers/nav-scenes';
import { PHONE } from '../helpers/nav-viewports';
import {
  LANGUAGES,
  languageName,
  plural,
  tIn,
  tabTitle,
  type Language,
} from '../helpers/settings-i18n';
import {
  AI_ACCESS_OFF,
  McpClient,
  PROTOCOL_VERSION,
} from '../helpers/settings-mcp';
import {
  documentLook,
  expectSettingsNotRead,
  languageButton,
  lightnessOf,
  openSettings,
  saveButton,
  discardButton,
  startPageField,
  tabLook,
  tabLookFor,
  themeRadio,
  aiAccessSwitch,
  SETTINGS_TAB_KEYS,
  type SettingsPage,
  type ThemeChoice,
} from '../helpers/settings-pages';

declare global {
  interface Window {
    /** Set by `watchForSavedLabel`: the Save button said "Saved" at some point. */
    savedLabelWasShown?: boolean;
  }
}

// What a test changes in the manager's settings goes back to the defaults when
// it ends, whether it passed or not; what it changes in the browser (theme,
// language) lives in the context the test was given and goes with it.
test.afterEach(async ({ api }) => {
  await api.updateSettings({ startPage: '', mcpEnabled: false });
});

/** The title of the browser tab for a settings page: its name, then the app's. */
function settingsTitle(translate: (key: string) => string, page: SettingsPage) {
  return tabTitle(translate(SETTINGS_TAB_KEYS[page]));
}

/** Records, from now on, whether the Save button ever reads "Saved" (it does for a moment after a save). */
async function watchForSavedLabel(page: Page): Promise<void> {
  const saved = t('common.actions.saved');
  await page.evaluate((label) => {
    window.savedLabelWasShown = false;
    const look = () => {
      const shown = Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === label,
      );
      if (shown) window.savedLabelWasShown = true;
    };
    new MutationObserver(look).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    look();
  }, saved);
}

function savedLabelWasShown(page: Page): Promise<boolean> {
  return page.evaluate(() => window.savedLabelWasShown === true);
}

/** The name of a fact in the About list. */
function aboutName(page: Page, name: string): Locator {
  return page
    .locator('dt')
    .filter({ hasText: new RegExp(`^${literally(name).source}$`) });
}

/** The value beside a name in the About list. */
function aboutValue(page: Page, name: string): Locator {
  return aboutName(page, name).locator('xpath=following-sibling::dd[1]');
}

/** The facts About lists, by the key of the name each goes by. */
const ABOUT_FACTS = ['version', 'browser', 'installed'] as const;

/** Tells the settings query the window has the focus again, which makes it read the server. */
async function refocusWindow(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(new Event('visibilitychange')),
  );
}

// =============================================================================
// General
// =============================================================================

test.describe('General: the start page', () => {
  test('the field holds the saved address, with the default as its placeholder and the hint for a blank one', async ({
    page,
    api,
  }) => {
    const settings = await api.settings();
    await openSettings(page, 'general');
    const field = startPageField(page);

    await expect(field).toHaveValue(settings.startPage);
    await expect(field).toHaveAttribute(
      'placeholder',
      settings.defaultStartPage,
    );
    await expect(
      page.getByText(t('settings.general.startPage.hint')),
    ).toBeVisible();
    await expect(
      page.getByText(t('settings.general.startPage.description')),
    ).toBeVisible();
    // What stands beside the field is what a screen reader reads with it.
    await expect(field).toHaveAccessibleDescription(
      new RegExp(
        `${literally(t('settings.general.startPage.description')).source}.*${
          literally(t('settings.general.startPage.hint')).source
        }`,
      ),
    );

    // Blank, the field shows the default as its placeholder.
    await field.fill('');
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute(
      'placeholder',
      settings.defaultStartPage,
    );
  });

  test('a blank field means the default: saving it brings the default back', async ({
    page,
    api,
  }) => {
    const { defaultStartPage } = await api.updateSettings({
      startPage: 'https://custom.example',
    });
    await openSettings(page, 'general');
    const field = startPageField(page);
    await expect(field).toHaveValue('https://custom.example');

    await field.fill('');
    await saveButton(page).click();

    await expect(field).toHaveValue(defaultStartPage);
    await expect
      .poll(async () => (await api.settings()).startPage, {
        message: 'the server stores the default for a blank start page',
      })
      .toBe(defaultStartPage);
  });

  test('"use the default" puts the default address in the field, and is offered only when it differs', async ({
    page,
    api,
  }) => {
    const { defaultStartPage } = await api.updateSettings({
      startPage: 'https://custom.example',
    });
    await openSettings(page, 'general');
    const field = startPageField(page);
    const useDefault = page.getByRole('button', {
      name: fill(t('settings.general.startPage.useDefault'), {
        url: defaultStartPage,
      }),
    });

    await expect(useDefault).toBeVisible();
    await useDefault.click();

    await expect(field).toHaveValue(defaultStartPage);
    await expect(field).toBeFocused();
    // The saved address is still the custom one: this is a change to save.
    await expect(saveButton(page)).toBeEnabled();
    // With the default in the field there is nothing to offer.
    await expect(useDefault).toHaveCount(0);

    await saveButton(page).click();
    await expect
      .poll(async () => (await api.settings()).startPage)
      .toBe(defaultStartPage);
  });

  test('an address is completed by the server, kept across a reload and opened by the next session', async ({
    page,
    api,
    control,
  }) => {
    await openSettings(page, 'general');
    const field = startPageField(page);

    await field.fill('example.com');
    await saveButton(page).click();

    // The server completed what was typed; the field shows what is saved.
    await expect(field).toHaveValue('https://example.com');
    await expect
      .poll(async () => (await api.settings()).startPage)
      .toBe('https://example.com');
    await page.reload();
    await expect(startPageField(page)).toHaveValue('https://example.com');

    // A session started afterwards opens it, in the one tab of its window.
    const session = await api.startSession('opens-start-page');
    const { tabs } = await control.browser(session.name);
    expect(tabs.map((tab) => tab.url)).toEqual(['https://example.com']);
  });

  test('a session you stop keeps its tabs; one whose last tab was closed opens the new start page', async ({
    page,
    api,
    control,
    request,
  }) => {
    const kept = await api.startSession('keeps-its-tabs');
    const closed = await api.startSession('lost-its-tabs');

    // The first session is stopped with its tab; the second ends because its
    // last tab was closed (which also makes it forget its tabs).
    await api.stopSession(kept.id);
    await control.closeAllTabs(closed.name);
    await api.waitForStatus(closed.id, 'stopped');

    await openSettings(page, 'general');
    await startPageField(page).fill('https://example.org');
    await saveButton(page).click();
    await expect
      .poll(async () => (await api.settings()).startPage)
      .toBe('https://example.org');

    for (const id of [kept.id, closed.id]) {
      const started = await request.post(`/api/sessions/${id}/start`, {
        data: { force: false },
      });
      expect(started.ok()).toBe(true);
      await api.waitForStatus(id, 'running');
    }

    // The windows the two starts opened: the one the first session had, and
    // the new start page for the second.
    const { defaultStartPage } = await api.settings();
    const urlsOf = async (name: string) =>
      (await control.browser(name)).tabs.map((tab) => tab.url);
    expect(await urlsOf(kept.name)).toEqual([defaultStartPage]);
    expect(await urlsOf(closed.name)).toEqual(['https://example.org']);
  });

  test('an address that is not a web address is refused in the words of the page, and nothing is saved', async ({
    page,
    api,
  }) => {
    const before = await api.settings();
    await openSettings(page, 'general');
    const field = startPageField(page);
    const refusal = page.getByText(t('errors.invalid_start_page'));
    await watchForSavedLabel(page);

    for (const invalid of [
      'not a web address',
      'ftp://example.com',
      'http://',
      'javascript:alert(1)',
    ]) {
      await field.fill(invalid);
      await saveButton(page).click();

      await expect(refusal, `"${invalid}" is refused`).toBeVisible();
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      // The refusal is read with the field.
      await expect(field).toHaveAccessibleDescription(
        new RegExp(literally(t('errors.invalid_start_page')).source),
      );
      // The draft stays, to be repaired; the refusal is not a save.
      await expect(field).toHaveValue(invalid);
      await expect(saveButton(page)).toBeEnabled();
      expect((await api.settings()).startPage).toBe(before.startPage);
    }
    expect(await savedLabelWasShown(page)).toBe(false);

    // Typing another address withdraws the refusal.
    await field.fill('example.org');
    await expect(refusal).toHaveCount(0);
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('a refused address puts the keyboard in the field to repair, from the button that was pressed', async ({
    page,
  }) => {
    await openSettings(page, 'general');
    const field = startPageField(page);

    await field.fill('ftp://nope.example');
    await saveButton(page).click();

    await expect(page.getByText(t('errors.invalid_start_page'))).toBeVisible();
    // The keyboard does not fall to the page: it is where the repair is made.
    await expect(field).toBeFocused();
  });

  test('Save and Discard are on only while the form differs from what is saved', async ({
    page,
    api,
  }) => {
    const saved = (await api.settings()).startPage;
    await openSettings(page, 'general');
    const field = startPageField(page);
    const save = saveButton(page);
    const discard = discardButton(page);

    await expect(save).toBeDisabled();
    await expect(discard).toBeDisabled();

    await field.fill('example.net');
    await expect(save).toBeEnabled();
    await expect(discard).toBeEnabled();

    // Discard returns to what is saved, and both go quiet.
    await discard.click();
    await expect(field).toHaveValue(saved);
    await expect(save).toBeDisabled();
    await expect(discard).toBeDisabled();

    // Typing the saved address is no change.
    await field.fill('x');
    await expect(save).toBeEnabled();
    await field.fill(saved);
    await expect(save).toBeDisabled();

    // Save says "Saved" for a moment, then both are quiet again.
    await watchForSavedLabel(page);
    await field.fill('https://example.net');
    await save.click();
    await expect(save).toBeDisabled();
    await expect(discard).toBeDisabled();
    // Both buttons are off while the save is on its way as well: the word comes
    // when the server has answered, so it is waited for, not looked at once.
    await expect
      .poll(() => savedLabelWasShown(page), {
        message: 'the button said "Saved" for a moment',
      })
      .toBe(true);
    expect((await api.settings()).startPage).toBe('https://example.net');
  });

  test('Enter and the save shortcut save the form', async ({ page, api }) => {
    await openSettings(page, 'general');
    const field = startPageField(page);

    await field.fill('enter.example.com');
    await field.press('Enter');
    await expect
      .poll(async () => (await api.settings()).startPage)
      .toBe('https://enter.example.com');
    await expect(saveButton(page)).toBeDisabled();

    await field.fill('shortcut.example.com');
    await page.keyboard.press('ControlOrMeta+s');
    await expect
      .poll(async () => (await api.settings()).startPage)
      .toBe('https://shortcut.example.com');

    // With nothing changed, Enter has nothing to say.
    await field.press('Enter');
    await expect(page.getByText(t('errors.invalid_start_page'))).toHaveCount(0);
    expect((await api.settings()).startPage).toBe(
      'https://shortcut.example.com',
    );
  });

  test('a change made elsewhere is taken over by a clean form, and offered to one with a draft', async ({
    page,
    api,
  }) => {
    await openSettings(page, 'general');
    const field = startPageField(page);

    // Clean: the form follows the server.
    await api.updateSettings({ startPage: 'https://assistant-one.example' });
    await refocusWindow(page);
    await expect(field).toHaveValue('https://assistant-one.example');
    await expect(saveButton(page)).toBeDisabled();

    // With a draft: the draft is the person's; the change is offered.
    await field.fill('draft.example.com');
    await api.updateSettings({ startPage: 'https://assistant-two.example' });
    await refocusWindow(page);
    await expect(
      page.getByText(t('settings.general.startPage.remote.message')),
    ).toBeVisible();
    await expect(field).toHaveValue('draft.example.com');

    // "Keep editing" dismisses the notice and keeps the draft.
    await page
      .getByRole('button', {
        name: t('settings.general.startPage.remote.keepEditing'),
      })
      .click();
    await expect(
      page.getByText(t('settings.general.startPage.remote.message')),
    ).toHaveCount(0);
    await expect(field).toHaveValue('draft.example.com');

    // Another change, and this time the saved address is shown.
    await api.updateSettings({ startPage: 'https://assistant-three.example' });
    await refocusWindow(page);
    await page
      .getByRole('button', {
        name: t('settings.general.startPage.remote.showSaved'),
      })
      .click();
    await expect(field).toHaveValue('https://assistant-three.example');
    await expect(saveButton(page)).toBeDisabled();
  });
});

test.describe('General: leaving with unsaved changes', () => {
  const unsavedDialog = (page: Page) =>
    page.getByRole('dialog', { name: t('common.unsavedChanges.title') });

  test('leaving by the rail or the panel asks first; "keep editing" stays, "discard & leave" goes', async ({
    page,
    api,
  }) => {
    const saved = (await api.settings()).startPage;
    await openSettings(page, 'general');
    const field = startPageField(page);

    // By the panel of Settings.
    await field.fill('draft.example.com');
    await page
      .getByRole('navigation', { name: t('settings.nav.label') })
      .getByRole('link', { name: t('settings.pages.appearance.title') })
      .click();
    await expect(unsavedDialog(page)).toBeVisible();
    await expect(
      unsavedDialog(page).getByText(t('common.unsavedChanges.description')),
    ).toBeVisible();
    // The safe answer has the focus.
    await expect(
      unsavedDialog(page).getByRole('button', {
        name: t('common.unsavedChanges.stay'),
      }),
    ).toBeFocused();
    await unsavedDialog(page)
      .getByRole('button', { name: t('common.unsavedChanges.stay') })
      .click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(field).toHaveValue('draft.example.com');

    // By the rail; Escape is "keep editing" too.
    await page
      .getByRole('link', {
        name: t('navigation.sections.proxies'),
        exact: true,
      })
      .click();
    await expect(unsavedDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(unsavedDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(field).toHaveValue('draft.example.com');

    // And now leave for good: the draft goes with it.
    await page
      .getByRole('link', {
        name: t('navigation.sections.proxies'),
        exact: true,
      })
      .click();
    await unsavedDialog(page)
      .getByRole('button', { name: t('common.unsavedChanges.discardAndLeave') })
      .click();
    await expect(page).toHaveURL(/\/proxies$/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('proxies.title') }),
    ).toBeVisible();
    await page
      .getByRole('link', {
        name: t('navigation.sections.settings'),
        exact: true,
      })
      .click();
    await expect(startPageField(page)).toHaveValue(saved);
    expect((await api.settings()).startPage).toBe(saved);
  });

  test('the browser\'s back button asks too, and the page is as it was after "keep editing"', async ({
    page,
  }) => {
    await openSettings(page, 'general');
    await page
      .getByRole('link', { name: t('settings.pages.appearance.title') })
      .click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await page
      .getByRole('link', { name: t('settings.pages.general.title') })
      .click();
    await expect(page).toHaveURL(/\/settings\/general$/);

    const field = startPageField(page);
    await field.fill('draft.example.com');
    await page.goBack();
    await expect(unsavedDialog(page)).toBeVisible();
    await unsavedDialog(page)
      .getByRole('button', { name: t('common.unsavedChanges.stay') })
      .click();
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(field).toHaveValue('draft.example.com');
    // The keyboard is back where the person was typing.
    await expect(field).toBeFocused();

    await page.goBack();
    await unsavedDialog(page)
      .getByRole('button', { name: t('common.unsavedChanges.discardAndLeave') })
      .click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
  });

  test("closing the page asks the browser's own question while a draft exists, and not otherwise", async ({
    page,
  }) => {
    await openSettings(page, 'general');
    const field = startPageField(page);
    // The handler the app arms for the browser's "leave this page?" question,
    // asked without leaving: does it object (cancel the event)?
    const objects = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    const asked: string[] = [];
    page.on('dialog', (dialog) => {
      asked.push(dialog.type());
      void dialog.dismiss();
    });

    // Nothing to lose: no objection.
    expect(await objects()).toBe(false);

    // A draft is typed (by a click and keys, as a person does: the browser
    // asks only a page the person has used), and the app objects.
    await field.click();
    await field.fill('draft.example.com');
    await expect.poll(objects).toBe(true);

    // The browser's own question is put when the page is closed...
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => asked).toEqual(['beforeunload']);
    // ...and dismissed, the page stays as it was.
    expect(page.isClosed()).toBe(false);
    await expect(field).toHaveValue('draft.example.com');

    // Discarding the draft withdraws the objection.
    await discardButton(page).click();
    await expect.poll(objects).toBe(false);
  });
});

test.describe('General: on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  const unsavedDialog = (page: Page) =>
    page.getByRole('dialog', { name: t('common.unsavedChanges.title') });
  const tabBar = (page: Page) =>
    page.getByRole('navigation', { name: t('navigation.aria.primary') });

  test('Save and Discard stand once in a dock above the tab bar, and work from there', async ({
    page,
    api,
  }) => {
    await openSettings(page, 'general');
    const field = startPageField(page);

    // The header's pair and the dock's never both exist: one Save, one Discard.
    await expect(saveButton(page)).toHaveCount(1);
    await expect(discardButton(page)).toHaveCount(1);
    await expect(saveButton(page)).toBeDisabled();
    await expect(discardButton(page)).toBeDisabled();

    await field.fill('https://phone.example');
    await expect(saveButton(page)).toBeEnabled();
    await expect(discardButton(page)).toBeEnabled();

    // The dock is in the window, under the field and above the tab bar.
    const [save, discard, bar, input] = await Promise.all([
      saveButton(page).boundingBox(),
      discardButton(page).boundingBox(),
      tabBar(page).boundingBox(),
      field.boundingBox(),
    ]);
    if (!save || !discard || !bar || !input) {
      throw new Error('The dock, the tab bar and the field are on the page');
    }
    for (const button of [save, discard]) {
      expect(button.x).toBeGreaterThanOrEqual(0);
      expect(button.x + button.width).toBeLessThanOrEqual(PHONE.width);
      expect(button.y).toBeGreaterThan(input.y + input.height);
      expect(button.y + button.height).toBeLessThanOrEqual(bar.y);
    }

    // Save keeps the draft, and says so for a moment.
    await saveButton(page).tap();
    await expect
      .poll(async () => (await api.settings()).startPage)
      .toBe('https://phone.example');
    await expect(saveButton(page)).toBeDisabled();

    // Discard puts the saved address back.
    await field.fill('https://other.example');
    await discardButton(page).tap();
    await expect(field).toHaveValue('https://phone.example');
    await expect(discardButton(page)).toBeDisabled();
    expect((await api.settings()).startPage).toBe('https://phone.example');
  });

  test('leaving by the tab bar with a draft asks first, as it does on a computer', async ({
    page,
    api,
  }) => {
    const saved = (await api.settings()).startPage;
    await openSettings(page, 'general');
    const field = startPageField(page);
    await field.fill('draft.example.com');

    await tabBar(page)
      .getByRole('button', {
        name: t('navigation.sections.proxies'),
        exact: true,
      })
      .tap();
    await expect(unsavedDialog(page)).toBeVisible();
    await unsavedDialog(page)
      .getByRole('button', { name: t('common.unsavedChanges.stay') })
      .tap();
    await expect(unsavedDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(field).toHaveValue('draft.example.com');

    await tabBar(page)
      .getByRole('button', {
        name: t('navigation.sections.proxies'),
        exact: true,
      })
      .tap();
    await unsavedDialog(page)
      .getByRole('button', { name: t('common.unsavedChanges.discardAndLeave') })
      .tap();
    await expect(page).toHaveURL(/\/proxies$/);
    expect((await api.settings()).startPage).toBe(saved);
  });
});

test.describe('General: About', () => {
  test('shows the version, the browser and whether it is installed', async ({
    page,
    api,
  }) => {
    const meta = await api.meta();
    await openSettings(page, 'general');

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: t('settings.general.about.title'),
      }),
    ).toBeVisible();
    await expect(
      aboutValue(page, t('settings.general.about.version')),
    ).toHaveText(meta.version);
    await expect(
      aboutValue(page, t('settings.general.about.browser')),
    ).toHaveText(
      fill(t('settings.general.about.browserBuild'), {
        version: meta.browserVersion,
      }),
    );
    await expect(
      aboutValue(page, t('settings.general.about.installed')),
    ).toHaveText(t('settings.general.about.installedYes'));
  });

  test('is the second of the two sections of the page, set off from "New sessions" by one hairline', async ({
    page,
  }) => {
    await openSettings(page, 'general');
    const sessions = page.getByRole('region', {
      name: t('settings.general.sessions.title'),
    });
    const about = page.getByRole('region', {
      name: t('settings.general.about.title'),
    });
    await expect(sessions).toBeVisible();
    await expect(about).toBeVisible();

    // The first section opens the page; the next is ruled off from it.
    await expect(sessions).toHaveCSS('border-top-width', '0px');
    await expect(about).toHaveCSS('border-top-width', '1px');
    const [above, below] = await Promise.all([
      sessions.boundingBox(),
      about.boundingBox(),
    ]);
    if (!above || !below) throw new Error('Both sections are on the page');
    expect(below.y).toBeGreaterThan(above.y + above.height);
  });

  test('puts the name of each fact and its value on one line on a computer', async ({
    page,
  }) => {
    await openSettings(page, 'general');
    for (const fact of ABOUT_FACTS) {
      const label = t(`settings.general.about.${fact}`);
      await expect(aboutValue(page, label)).toBeVisible();
      const [name, value] = await Promise.all([
        aboutName(page, label).boundingBox(),
        aboutValue(page, label).boundingBox(),
      ]);
      if (!name || !value) throw new Error(`${fact} is on the page`);
      expect(
        value.y,
        `${fact}: the value is on the line of its name`,
      ).toBeCloseTo(name.y, 0);
      expect(
        value.x,
        `${fact}: the value stands after its name`,
      ).toBeGreaterThan(name.x + name.width);
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE, hasTouch: true });

    test('puts the value of each fact under its name', async ({ page }) => {
      await openSettings(page, 'general');
      for (const fact of ABOUT_FACTS) {
        const label = t(`settings.general.about.${fact}`);
        await expect(aboutValue(page, label)).toBeVisible();
        const [name, value] = await Promise.all([
          aboutName(page, label).boundingBox(),
          aboutValue(page, label).boundingBox(),
        ]);
        if (!name || !value) throw new Error(`${fact} is on the page`);
        expect(
          value.y,
          `${fact}: the value is under its name`,
        ).toBeGreaterThanOrEqual(name.y + name.height);
        expect(
          value.x,
          `${fact}: the value begins where its name does`,
        ).toBeCloseTo(name.x, 0);
      }
    });
  });

  test('says when the browser is being installed, when it is not, and when nothing can be read', async ({
    page,
  }) => {
    const installed = aboutValue(page, t('settings.general.about.installed'));
    const meta = (browser: { installed: boolean; installing: boolean }) =>
      page.route('**/api/meta', async (route) => {
        const response = await route.fetch();
        const body: unknown = await response.json();
        await route.fulfill({
          response,
          json: {
            ...(typeof body === 'object' && body !== null ? body : {}),
            browserInstalled: browser.installed,
            browserInstalling: browser.installing,
            browserInstallError: null,
          },
        });
      });

    await meta({ installed: false, installing: true });
    await openSettings(page, 'general');
    await expect(installed).toHaveText(t('settings.general.about.installing'));

    await page.unroute('**/api/meta');
    await meta({ installed: false, installing: false });
    await page.reload();
    await expect(installed).toHaveText(t('settings.general.about.installedNo'));

    await page.unroute('**/api/meta');
    await page.route('**/api/meta', (route) => route.abort());
    await page.reload();
    for (const fact of ABOUT_FACTS) {
      await expect(
        aboutValue(page, t(`settings.general.about.${fact}`)),
        `the ${fact} row says it is unavailable`,
      ).toHaveText(t('settings.general.about.unavailable'));
    }
  });

  test('the start page says it could not be read, and reads it again on request', async ({
    page,
    api,
  }) => {
    await api.updateSettings({ startPage: 'https://readable.example' });
    await page.route('**/api/settings', (route) => route.abort());
    await openSettings(page, 'general');

    await expectSettingsNotRead(page, 'network');
    await expect(startPageField(page)).toHaveCount(0);

    await page.unroute('**/api/settings');
    await page
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await expect(startPageField(page)).toHaveValue('https://readable.example');
  });
});

test.describe('General: when the settings cannot be read', () => {
  // What the page says follows the code of the answer: it names what could
  // not be read, and adds the cause only where trying again does not mend it.
  const failures: Array<{
    what: string;
    code: string;
    answer: (route: Route) => Promise<void>;
  }> = [
    {
      what: 'no answer at all',
      code: 'network',
      answer: (route) => route.abort(),
    },
    {
      what: 'a fault of the backend',
      code: 'internal_error',
      answer: (route) =>
        route.fulfill({
          status: 500,
          json: { error: 'internal_error', message: 'Something went wrong.' },
        }),
    },
    {
      what: 'the error page of a gateway, which is no answer of the backend',
      code: 'server_error',
      answer: (route) =>
        route.fulfill({
          status: 502,
          contentType: 'text/html',
          body: '<h1>Bad Gateway</h1>',
        }),
    },
    {
      what: 'a code the app has no words for',
      code: 'fallback',
      answer: (route) =>
        route.fulfill({
          status: 418,
          json: { error: 'a_code_from_the_future', message: 'Not known.' },
        }),
    },
    {
      what: 'an answer the page cannot read',
      code: 'bad_answer',
      answer: (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<h1>Not Session Manager</h1>',
        }),
    },
    {
      what: 'a refusal that names a cause trying again does not mend',
      code: 'forbidden_host',
      answer: (route) =>
        route.fulfill({
          status: 403,
          json: { error: 'forbidden_host', message: 'Not that name.' },
        }),
    },
  ];

  for (const { what, code, answer } of failures) {
    test(`is worded for ${what}, with a way to try again`, async ({ page }) => {
      await page.route('**/api/settings', answer);
      await page.goto('/settings/general');

      await expectSettingsNotRead(page, code);
      await expect(
        page.getByRole('button', { name: t('common.actions.tryAgain') }),
      ).toBeVisible();
    });
  }
});

// =============================================================================
// AI access
// =============================================================================

test.describe('AI access: the switch', () => {
  test('is off to begin with, takes effect at once in both directions and survives a reload', async ({
    page,
    api,
  }) => {
    await openSettings(page, 'ai-access');
    const toggle = aiAccessSwitch(page);
    const changed = () =>
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/settings' &&
          response.request().method() === 'PATCH',
      );

    await expect(toggle).not.toBeChecked();
    expect((await api.settings()).mcpEnabled).toBe(false);

    const switchedOn = changed();
    await toggle.click();
    await switchedOn;
    await expect(toggle).toBeChecked();
    expect((await api.settings()).mcpEnabled).toBe(true);
    await page.reload();
    await expect(aiAccessSwitch(page)).toBeChecked();

    const switchedOff = changed();
    await aiAccessSwitch(page).click();
    await switchedOff;
    await expect(aiAccessSwitch(page)).not.toBeChecked();
    expect((await api.settings()).mcpEnabled).toBe(false);
    await page.reload();
    await expect(aiAccessSwitch(page)).not.toBeChecked();
  });

  test('is a switch a keyboard can operate, named and described', async ({
    page,
    api,
  }) => {
    await openSettings(page, 'ai-access');
    const toggle = aiAccessSwitch(page);
    await expect(toggle).toHaveAccessibleDescription(
      t('settings.aiAccess.switch.description'),
    );

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect.poll(async () => (await api.settings()).mcpEnabled).toBe(true);
    // The focus stays on the switch while the change is on its way and after.
    await expect(toggle).toBeFocused();
    // A second key waits for the first change to be over, it is not queued.
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Space');
    await expect(toggle).not.toBeChecked();
    await expect
      .poll(async () => (await api.settings()).mcpEnabled)
      .toBe(false);
  });

  test('follows a change made elsewhere when the window comes back', async ({
    page,
    api,
  }) => {
    await openSettings(page, 'ai-access');
    await expect(aiAccessSwitch(page)).not.toBeChecked();

    await api.updateSettings({ mcpEnabled: true });
    await refocusWindow(page);
    await expect(aiAccessSwitch(page)).toBeChecked();
  });

  test('snaps back and says why when the server refuses the change', async ({
    page,
    api,
  }) => {
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      return route.fulfill({
        status: 500,
        json: { error: 'internal_error', message: 'Something went wrong.' },
      });
    });
    await openSettings(page, 'ai-access');
    const toggle = aiAccessSwitch(page);

    await toggle.click();

    // Exact: the live region that announces the toast repeats it with more words.
    await expect(
      page.getByText(t('settings.aiAccess.switch.changeFailed'), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(toggle).not.toBeChecked();
    expect((await api.settings()).mcpEnabled).toBe(false);
  });

  test('a read that failed is not shown as "off": the page says so and offers to try again', async ({
    page,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    await page.route('**/api/settings', (route) => route.abort());
    await page.goto('/settings/ai-access');

    await expectSettingsNotRead(page, 'network');
    await expect(aiAccessSwitch(page)).toHaveCount(0);

    await page.unroute('**/api/settings');
    await page
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await expect(aiAccessSwitch(page)).toBeChecked();
  });
});

test.describe('AI access: what the page offers', () => {
  test('while AI access is off it shows the switch, the warning and what switching on gives, and nothing to connect with', async ({
    page,
  }) => {
    await openSettings(page, 'ai-access');
    await expect(aiAccessSwitch(page)).not.toBeChecked();

    await expect(
      page.getByText(t('settings.aiAccess.warning.lead')),
    ).toBeVisible();
    await expect(
      page.getByText(t('settings.aiAccess.off.description')),
    ).toBeVisible();
    // An address that answers 403 is not offered.
    for (const absent of [
      page.getByRole('heading', {
        level: 2,
        name: t('settings.aiAccess.connect.title'),
      }),
      page.getByRole('heading', {
        level: 2,
        name: t('settings.aiAccess.tools.title'),
      }),
      page.getByRole('button', {
        name: new RegExp(
          `^${literally(t('settings.aiAccess.connect.address')).source}`,
        ),
      }),
      page.getByRole('tablist'),
      page.locator('pre'),
      page.locator('details'),
    ]) {
      await expect(absent).toHaveCount(0);
    }
  });

  test('switching it on shows how to connect and the tools, and switching it off takes them away', async ({
    page,
  }) => {
    await openSettings(page, 'ai-access');
    const toggle = aiAccessSwitch(page);
    const connect = page.getByRole('heading', {
      level: 2,
      name: t('settings.aiAccess.connect.title'),
    });
    const tools = page.getByRole('heading', {
      level: 2,
      name: t('settings.aiAccess.tools.title'),
    });

    await toggle.click();
    await expect(connect).toBeVisible();
    await expect(tools).toBeVisible();
    // Three assistants to pick from, the snippet of the one picked.
    await expect(
      page
        .getByRole('tablist', { name: t('settings.aiAccess.connect.clients') })
        .getByRole('tab'),
    ).toHaveCount(3);
    await expect(page.locator('pre')).toHaveCount(1);
    await expect(page.locator('details')).toHaveCount(5);
    await expect(
      page.getByText(t('settings.aiAccess.off.description')),
    ).toHaveCount(0);

    await expect(toggle).not.toHaveAttribute('aria-busy', 'true');
    await toggle.click();
    await expect(connect).toHaveCount(0);
    await expect(tools).toHaveCount(0);
    await expect(
      page.getByText(t('settings.aiAccess.off.description')),
    ).toBeVisible();
  });

  test('shows only what the server holds: a read that failed offers no address', async ({
    page,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    await page.route('**/api/settings', (route) => route.abort());
    await page.goto('/settings/ai-access');
    await expectSettingsNotRead(page, 'network');
    await expect(page.locator('pre')).toHaveCount(0);
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: t('settings.aiAccess.connect.title'),
      }),
    ).toHaveCount(0);
  });
});

test.describe('AI access: the endpoint obeys the switch', () => {
  test('/mcp answers 403 while it is off and speaks MCP once it is on, with no reload in between', async ({
    page,
    request,
    api,
  }) => {
    const mcp = new McpClient(request);
    const session = await api.startSession('listed-by-assistant');

    // Off: refused, for any method, before the body is read.
    for (const refused of [
      await mcp.send('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      }),
      await mcp.send('tools/list'),
      await request.get('/mcp'),
    ]) {
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toEqual(AI_ACCESS_OFF);
    }

    // The person switches it on in the page.
    await openSettings(page, 'ai-access');
    const patched = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/settings' &&
        response.request().method() === 'PATCH',
    );
    await aiAccessSwitch(page).click();
    await patched;

    // On: a client can start a conversation, list the tools and use one.
    const server = await mcp.initialize();
    expect(server.serverInfo.name).toBe('session-manager');
    expect(server.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(server.capabilities.tools).toBeDefined();
    const tools = await mcp.toolNames();
    expect(tools).toHaveLength(43);
    expect(tools).toEqual(
      expect.arrayContaining(['overview', 'list_sessions', 'show_window']),
    );
    const listing = await mcp.call('list_sessions');
    expect(listing.isError).toBe(false);
    expect(listing.text).toContain('listed-by-assistant');
    expect(listing.text).toContain(String(session.id));
    // Only POST speaks to it: there is no event stream to open.
    const stream = await request.get('/mcp');
    expect(stream.status()).toBe(405);
    expect(stream.headers()['allow']).toBe('POST');

    // Off again: refused again, at once.
    await expect(aiAccessSwitch(page)).not.toHaveAttribute('aria-busy', 'true');
    const patchedBack = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/settings' &&
        response.request().method() === 'PATCH',
    );
    await aiAccessSwitch(page).click();
    await patchedBack;
    const refused = await mcp.send('tools/list');
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual(AI_ACCESS_OFF);
  });

  test('an assistant cannot switch AI access on, because no tool does', async ({
    request,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    const mcp = new McpClient(request);
    await mcp.initialize();

    const tools = await mcp.toolNames();
    expect(tools.filter((tool) => /access|mcp|enable/i.test(tool))).toEqual([]);

    // What the settings tools can set is the start page and nothing else.
    const settings = await mcp.call('get_settings');
    expect(settings.isError).toBe(false);
    const attempt = await mcp.call('set_start_page', {
      url: 'https://example.org',
    });
    expect(attempt.isError).toBe(false);
    expect((await api.settings()).mcpEnabled).toBe(true);
    expect((await api.settings()).startPage).toBe('https://example.org');
  });

  test('switching it off ends a wait an assistant is in, at once and as a refusal', async ({
    request,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    const mcp = new McpClient(request);
    await mcp.initialize();

    // A wait far longer than the test: the answer is the refusal, never the end of it.
    const WAIT_SECONDS = 60;
    const started = Date.now();
    const waiting = mcp.send(
      'tools/call',
      { name: 'wait', arguments: { seconds: WAIT_SECONDS } },
      { 'MCP-Protocol-Version': PROTOCOL_VERSION },
    );
    await api.updateSettings({ mcpEnabled: false });
    const refused = await waiting;

    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual(AI_ACCESS_OFF);
    expect(Date.now() - started).toBeLessThan(TIMEOUT.VISIBLE);
  });

  test('marks the tools that only look as read-only, and not the ones that show a secret or the proxy passwords', async ({
    request,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    const mcp = new McpClient(request);
    await mcp.initialize();
    const tools = await mcp.tools();
    const readOnly = (name: string) =>
      tools.find((tool) => tool.name === name)?.annotations.readOnlyHint;

    for (const name of [
      'overview',
      'list_sessions',
      'list_secrets',
      'read_page',
    ]) {
      expect(readOnly(name), `${name} only looks`).toBe(true);
    }
    for (const name of ['get_secret', 'export_proxies']) {
      expect(readOnly(name), `${name} shows what is confidential`).not.toBe(
        true,
      );
    }
  });

  test('hands over what a page says between lines that call it untrusted, which carry one code', async ({
    request,
    api,
  }) => {
    const session = await api.startSession('read-by-assistant');
    await api.updateSettings({ mcpEnabled: true });
    const mcp = new McpClient(request);
    await mcp.initialize();

    const page = await mcp.call('read_page', { session: session.id });

    expect(page.isError).toBe(false);
    // The code is a different one for every answer, so that a page cannot
    // write the line that ends its own frame.
    const framed =
      /^<<< BEGIN UNTRUSTED PAGE CONTENT (\w+) [^\n]*>>>\n([\s\S]*)\n<<< END UNTRUSTED PAGE CONTENT \1 >>>$/.exec(
        page.text,
      );
    expect(framed, page.text).not.toBeNull();
    expect(framed?.[2]).toContain(fakeTabTitle('https://www.google.com'));
  });

  test('the page lists the tools the endpoint offers, group by group', async ({
    page,
    request,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    const offered = await new McpClient(request).toolNames();
    await openSettings(page, 'ai-access');

    const groups = page.locator('details');
    await expect(groups).toHaveCount(5);
    const listed: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const group = groups.nth(index);
      await group.locator('summary').click();
      await expect(group).toHaveJSProperty('open', true);
      const names = await group.locator('li code').allTextContents();
      // The summary says how many tools the group holds.
      await expect(group.locator('summary')).toContainText(
        plural(t('settings.aiAccess.tools.count'), names.length),
      );
      listed.push(...names);
    }

    expect(listed).toHaveLength(offered.length);
    expect([...listed].sort()).toEqual([...offered].sort());
  });
});

test.describe('AI access: how to connect', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  // How to connect an assistant is shown once AI access is on.
  test.beforeEach(async ({ api }) => {
    await api.updateSettings({ mcpEnabled: true });
  });

  /** What each block must say for an origin: the command and the two configurations. */
  function expectedSnippets(origin: string) {
    const url = `${origin}/mcp`;
    return {
      url,
      command: `claude mcp add --transport http session-manager ${url}`,
      json: JSON.stringify(
        { mcpServers: { 'session-manager': { url } } },
        null,
        2,
      ),
      desktop: JSON.stringify(
        {
          mcpServers: {
            'session-manager': {
              command: 'npx',
              args: ['-y', 'mcp-remote', url, '--allow-http'],
            },
          },
        },
        null,
        2,
      ),
    };
  }

  /**
   * The assistants to pick from, in the order of the tabs: the key of the
   * sentence over the snippet, the key of the tab's name, the key of the copy
   * button's name and the snippet itself, for the origin the page is served from.
   */
  function assistants(origin: string) {
    const snippets = expectedSnippets(origin);
    return [
      {
        step: 'claudeCode',
        tab: 'clientClaudeCode',
        copy: 'copyCommand',
        text: snippets.command,
      },
      {
        step: 'cursor',
        tab: 'clientCursor',
        copy: 'copyConfig',
        text: snippets.json,
      },
      {
        step: 'claudeDesktop',
        tab: 'clientClaudeDesktop',
        copy: 'copyConfig',
        text: snippets.desktop,
      },
    ] as const;
  }

  const tabOf = (page: Page, tabKey: string) =>
    page.getByRole('tab', {
      name: t(`settings.aiAccess.connect.${tabKey}`),
      exact: true,
    });

  /** Picks an assistant and waits until its snippet is the one shown. */
  async function pick(page: Page, tabKey: string): Promise<void> {
    const tab = tabOf(page, tabKey);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }

  /** The text of the snippet shown: one at a time, under the assistant picked. */
  const shownSnippets = (page: Page) => page.locator('pre').allTextContents();

  test('offers the three assistants as tabs, the first picked, and shows the snippet of the one picked', async ({
    page,
  }) => {
    await openSettings(page, 'ai-access');
    const origin = new URL(page.url()).origin;
    const [first, ...others] = assistants(origin);
    if (first === undefined) throw new Error('An assistant is expected');
    const list = page.getByRole('tablist', {
      name: t('settings.aiAccess.connect.clients'),
    });
    await expect(list).toBeVisible();
    await expect(list.getByRole('tab')).toHaveText(
      [first, ...others].map((one) =>
        t(`settings.aiAccess.connect.${one.tab}`),
      ),
    );

    // The first is picked when the page opens, and its snippet is the only one.
    await expect(tabOf(page, first.tab)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('pre')).toHaveCount(1);
    expect(await shownSnippets(page)).toEqual([first.text]);

    for (const one of others) {
      await expect(tabOf(page, one.tab)).toHaveAttribute(
        'aria-selected',
        'false',
      );
    }

    // Picking another puts its snippet in the place of the first.
    for (const one of others) {
      await pick(page, one.tab);
      await expect(
        page.getByRole('tabpanel', {
          name: t(`settings.aiAccess.connect.${one.tab}`),
        }),
      ).toBeVisible();
      await expect(page.locator('pre')).toHaveCount(1);
      expect(await shownSnippets(page), one.tab).toEqual([one.text]);
    }
    await expect(tabOf(page, first.tab)).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('the tabs are walked by the arrow keys, and the snippet follows the one the focus is on', async ({
    page,
  }) => {
    await openSettings(page, 'ai-access');
    const origin = new URL(page.url()).origin;
    const [first, second, third] = assistants(origin);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('Three assistants are expected');
    }

    await tabOf(page, first.tab).focus();
    for (const [key, next] of [
      ['ArrowRight', second],
      ['ArrowRight', third],
      // Past the last it starts again at the first, and back the other way.
      ['ArrowRight', first],
      ['ArrowLeft', third],
      ['Home', first],
      ['End', third],
    ] as const) {
      await page.keyboard.press(key);
      await expect(tabOf(page, next.tab), key).toBeFocused();
      await expect(tabOf(page, next.tab), key).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect
        .poll(() => shownSnippets(page), { message: `${key}: the snippet` })
        .toEqual([next.text]);
    }
  });

  test('shows the address and the snippet of each assistant for the origin the page was opened from', async ({
    page,
    server,
  }) => {
    for (const host of ['localhost', '127.0.0.1']) {
      const origin = `http://${host}:${server.port}`;
      const expected = expectedSnippets(origin);
      await page.goto(`${origin}/settings/ai-access`);
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: t('settings.pages.aiAccess.title'),
        }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

      await expect(
        page.getByRole('button', {
          name: `${t('settings.aiAccess.connect.address')} ${expected.url}`,
        }),
        `the address for ${host}`,
      ).toBeVisible();
      for (const one of assistants(origin)) {
        await pick(page, one.tab);
        await expect
          .poll(() => shownSnippets(page), {
            message: `${host}: the snippet of ${one.tab}`,
          })
          .toEqual([one.text]);
      }
      // The configurations are JSON an assistant can read.
      expect(JSON.parse(expected.json)).toEqual({
        mcpServers: { 'session-manager': { url: expected.url } },
      });
      expect(JSON.parse(expected.desktop)).toEqual({
        mcpServers: {
          'session-manager': {
            command: 'npx',
            args: ['-y', 'mcp-remote', expected.url, '--allow-http'],
          },
        },
      });
    }
  });

  test('says what each snippet is for', async ({ page }) => {
    await openSettings(page, 'ai-access');
    for (const one of assistants(new URL(page.url()).origin)) {
      await pick(page, one.tab);
      await expect(
        page.getByText(t(`settings.aiAccess.connect.${one.step}`), {
          exact: true,
        }),
        one.step,
      ).toBeVisible();
    }
    await expect(
      page.getByText(t('settings.aiAccess.connect.description')),
    ).toBeVisible();
    await expect(
      page.getByText(t('settings.aiAccess.connect.addressHint')),
    ).toBeVisible();
  });

  test('each copy button puts exactly the text beside it on the clipboard, and says it did', async ({
    page,
  }) => {
    await openSettings(page, 'ai-access');
    const readClipboard = () =>
      page.evaluate(() => navigator.clipboard.readText());
    const origin = new URL(page.url()).origin;
    const expected = expectedSnippets(origin);

    // One snippet is shown at a time, so there is one copy button for it (the
    // address is copied by its own pill, which is named by what it holds).
    await expect(
      page.getByRole('button', {
        name: new RegExp(literally(t('common.actions.copy')).source, 'i'),
      }),
    ).toHaveCount(1);

    // The address: the whole pill is the button, and it announces "Copied".
    await page
      .getByRole('button', {
        name: `${t('settings.aiAccess.connect.address')} ${expected.url}`,
      })
      .click();
    await expect.poll(readClipboard).toBe(expected.url);
    await expect(
      page.getByRole('status').filter({ hasText: t('common.actions.copied') }),
    ).toHaveText(t('common.actions.copied'));
    // ...and takes the word back after a moment.
    await expect(
      page.getByRole('status').filter({ hasText: t('common.actions.copied') }),
    ).toHaveCount(0);

    let copy = page.getByRole('button', { name: 'unset' });
    for (const one of assistants(origin)) {
      await pick(page, one.tab);
      copy = page.getByRole('button', {
        name: t(`settings.aiAccess.connect.${one.copy}`),
        exact: true,
      });
      await copy.click();
      await expect
        .poll(readClipboard, {
          message: `the clipboard holds the ${one.tab} snippet`,
        })
        .toBe(one.text);
      // It is the text shown beside the button, character for character.
      expect(await shownSnippets(page)).toEqual([await readClipboard()]);
      // The button shows it was done...
      await expect(copy.locator('svg.lucide-check')).toBeVisible();
    }
    // ...and goes back to "copy" after a moment.
    await expect(copy.locator('svg.lucide-copy')).toBeVisible();
  });

  test('copying the address fails in the open when the browser refuses the clipboard', async ({
    page,
  }) => {
    await openSettings(page, 'ai-access');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('no clipboard here')),
        },
        configurable: true,
      });
    });
    await page
      .getByRole('button', {
        name: new RegExp(
          `^${literally(t('settings.aiAccess.connect.address')).source}`,
        ),
      })
      .click();
    // Exact: the live region that announces the toast repeats it with more words.
    await expect(
      page.getByText(t('common.errors.failedToCopy'), { exact: true }),
    ).toBeVisible();
  });
});

test.describe('AI access: what it lets an assistant do', () => {
  test('the warning about a connected assistant is on the page, whether the switch is off or on', async ({
    page,
    api,
  }) => {
    for (const enabled of [false, true]) {
      await api.updateSettings({ mcpEnabled: enabled });
      await openSettings(page, 'ai-access');
      await expect(aiAccessSwitch(page)).toBeChecked({ checked: enabled });

      await expect(
        page.getByText(t('settings.aiAccess.warning.lead')),
        `the warning, AI access ${enabled ? 'on' : 'off'}`,
      ).toBeVisible();
      await expect(
        page.getByText(t('settings.aiAccess.warning.detail')),
      ).toBeVisible();
    }
  });

  test('describes the five groups of tools, closed, with how many each holds', async ({
    page,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    await openSettings(page, 'ai-access');
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: t('settings.aiAccess.tools.title'),
      }),
    ).toBeVisible();
    await expect(
      page.getByText(t('settings.aiAccess.tools.description')),
    ).toBeVisible();

    const counts = {
      overview: 3,
      sessions: 11,
      proxies: 5,
      browser: 18,
      secrets: 6,
    };
    for (const [group, count] of Object.entries(counts)) {
      const summary = page.locator('summary', {
        hasText: t(`settings.aiAccess.tools.${group}.title`),
      });
      await expect(summary, group).toContainText(
        plural(t('settings.aiAccess.tools.count'), count),
      );
      await expect(summary.locator('xpath=..')).toHaveJSProperty('open', false);
    }

    // Opening a group says what it is for and names its tools.
    await page
      .locator('summary', {
        hasText: t('settings.aiAccess.tools.proxies.title'),
      })
      .click();
    await expect(
      page.getByText(t('settings.aiAccess.tools.proxies.description')),
    ).toBeVisible();
    await expect(
      page.locator('li code', { hasText: /^check_proxies$/ }),
    ).toBeVisible();
  });

  /**
   * Where a press can land on the row of a group of tools, from its box: the
   * whole row is the control, to a few pixels of its edge.
   */
  const EDGES = (box: { width: number; height: number }) =>
    [
      ['4 px inside its top edge', { x: box.width / 2, y: 4 }],
      ['4 px inside its bottom edge', { x: box.width / 2, y: box.height - 4 }],
      ['8 px inside its left edge', { x: 8, y: box.height / 2 }],
    ] as const;

  test('opens and closes a group of tools with a click anywhere in its row, to its very edge', async ({
    page,
    api,
  }) => {
    await api.updateSettings({ mcpEnabled: true });
    await openSettings(page, 'ai-access');
    const group = page.locator('details').first();
    const summary = group.locator('summary');
    await expect(summary).toBeVisible();
    const box = await summary.boundingBox();
    if (!box) throw new Error('The first group is on the page');

    for (const [where, position] of EDGES(box)) {
      await summary.click({ position });
      await expect(group, `opened by a click ${where}`).toHaveJSProperty(
        'open',
        true,
      );
      await summary.click({ position });
      await expect(group, `closed by a click ${where}`).toHaveJSProperty(
        'open',
        false,
      );
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE, hasTouch: true });

    test('opens and closes a group of tools with a tap anywhere in its row, to its very edge', async ({
      page,
      api,
    }) => {
      await api.updateSettings({ mcpEnabled: true });
      await openSettings(page, 'ai-access');
      const group = page.locator('details').first();
      const summary = group.locator('summary');
      await expect(summary).toBeVisible();
      const box = await summary.boundingBox();
      if (!box) throw new Error('The first group is on the page');

      for (const [where, position] of EDGES(box)) {
        await summary.tap({ position });
        await expect(group, `opened by a tap ${where}`).toHaveJSProperty(
          'open',
          true,
        );
        await summary.tap({ position });
        await expect(group, `closed by a tap ${where}`).toHaveJSProperty(
          'open',
          false,
        );
      }
    });
  });
});

// =============================================================================
// Appearance
// =============================================================================

test.describe('Appearance: the page', () => {
  test('is one section, "This device", that says what it keeps on this device, with a group for each preference', async ({
    page,
  }) => {
    await openSettings(page, 'appearance');
    const section = page.getByRole('region', {
      name: t('settings.appearance.browser.title'),
    });
    await expect(section).toBeVisible();
    await expect(
      section.getByRole('heading', {
        level: 2,
        name: t('settings.appearance.browser.title'),
      }),
    ).toBeVisible();
    await expect(
      section.getByText(t('settings.appearance.browser.description')),
    ).toBeVisible();

    for (const preference of ['theme', 'language'] as const) {
      const group = section.getByRole('group', {
        name: t(`settings.appearance.${preference}.label`),
      });
      await expect(group, preference).toBeVisible();
      await expect(
        group.getByText(t(`settings.appearance.${preference}.description`)),
        preference,
      ).toBeVisible();
    }
  });
});

test.describe('Appearance: the theme', () => {
  test('each choice applies at once and is kept across a reload', async ({
    page,
  }) => {
    await openSettings(page, 'appearance');
    await expect(themeRadio(page, 'system')).toBeChecked();
    // Nothing is stored until the person chooses.
    expect((await documentLook(page)).storedTheme).toBeNull();

    for (const choice of [
      'dark',
      'light',
      'dark',
    ] as const satisfies ThemeChoice[]) {
      await themeRadio(page, choice).click();
      await expect(themeRadio(page, choice)).toBeChecked();
      await expect
        .poll(async () => (await documentLook(page)).dark, {
          message: `the page is ${choice}`,
        })
        .toBe(choice === 'dark');
      // The tab's icon and colour follow it.
      await expect
        .poll(() => tabLook(page), { message: `the tab is ${choice}` })
        .toEqual(tabLookFor(choice));
      const look = await documentLook(page);
      expect(look.colorScheme).toBe(choice);
      expect(look.storedTheme).toBe(choice);
      // The colours really changed: a dark page is dark, a light page is light.
      if (choice === 'dark')
        expect(lightnessOf(look.background)).toBeLessThan(0.2);
      else expect(lightnessOf(look.background)).toBeGreaterThan(0.8);

      await page.reload();
      await expect(themeRadio(page, choice)).toBeChecked();
      expect((await documentLook(page)).dark).toBe(choice === 'dark');
    }
  });

  test('"system" follows the system\'s colour scheme, and a choice of its own does not', async ({
    page,
  }) => {
    await openSettings(page, 'appearance');
    await themeRadio(page, 'system').click();
    await expect(themeRadio(page, 'system')).toBeChecked();

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await documentLook(page)).dark).toBe(true);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await documentLook(page)).dark).toBe(false);

    // The choice survives the reload, and so does following the system.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(themeRadio(page, 'system')).toBeChecked();
    await expect.poll(async () => (await documentLook(page)).dark).toBe(true);

    // A theme chosen by the person stays whatever the system does.
    await themeRadio(page, 'light').click();
    await expect.poll(async () => (await documentLook(page)).dark).toBe(false);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(themeRadio(page, 'light')).toBeChecked();
    expect((await documentLook(page)).dark).toBe(false);
  });

  test('the arrow keys move through the three choices and apply each', async ({
    page,
  }) => {
    await openSettings(page, 'appearance');
    await themeRadio(page, 'system').focus();

    await page.keyboard.press('ArrowRight');
    await expect(themeRadio(page, 'light')).toBeChecked();
    await expect(themeRadio(page, 'light')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(themeRadio(page, 'dark')).toBeChecked();
    await expect.poll(async () => (await documentLook(page)).dark).toBe(true);
    // It wraps around.
    await page.keyboard.press('ArrowRight');
    await expect(themeRadio(page, 'system')).toBeChecked();
  });

  test('a stored dark theme is on the document before the app has started, whatever the system is set to', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      localStorage.setItem('tale-theme', 'dark');
    });
    // The script of the app waits; what the page itself runs while it is
    // parsed is all there is to apply the theme, so a person on Dark never
    // sees the light palette while the app loads.
    let start: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      start = resolve;
    });
    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto('/settings/appearance', { waitUntil: 'commit' });
    await expect
      .poll(() => documentLook(page), {
        message: 'the document is dark before the app runs',
      })
      .toMatchObject({ dark: true, colorScheme: 'dark' });
    // So are the tab's icon and colour.
    expect(await tabLook(page)).toEqual(tabLookFor('dark'));
    // Nothing of the app is on the page yet.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
    expect(lightnessOf((await documentLook(page)).background)).toBeLessThan(
      0.2,
    );

    start();
    await expect(themeRadio(page, 'dark')).toBeChecked({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    expect((await documentLook(page)).dark).toBe(true);
  });
});

test.describe('Appearance: the language', () => {
  test('lists the three languages by their own names and marks the one shown', async ({
    page,
  }) => {
    await openSettings(page, 'appearance');
    const trigger = languageButton(page);
    await expect(trigger).toHaveAccessibleName(
      `${t('languageSwitcher.ariaLabel')}: ${languageName('en')}`,
    );
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = page.getByRole('menuitem');
    await expect(items).toHaveText(LANGUAGES.map(languageName));
    await expect(
      page.getByRole('menuitem', { name: languageName('en') }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(
      page.getByRole('menuitem', { name: languageName('de') }),
    ).not.toHaveAttribute('aria-current', 'true');

    // Escape closes it and the keyboard goes back to the button.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('choosing a language switches the whole page at once, and the choice is kept', async ({
    page,
  }) => {
    await openSettings(page, 'appearance');
    let shown: Language = 'en';

    for (const next of ['de', 'fr', 'en'] as const satisfies Language[]) {
      await languageButton(page, tIn[shown]).click();
      await page.getByRole('menuitem', { name: languageName(next) }).click();
      shown = next;
      const words = tIn[next];

      // Every part of the frame speaks the new language.
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: words('settings.pages.appearance.title'),
        }),
      ).toBeVisible();
      for (const section of [
        'sessions',
        'proxies',
        'secrets',
        'settings',
      ] as const) {
        await expect(
          page
            .getByRole('link', {
              name: words(`navigation.sections.${section}`),
              exact: true,
            })
            .first(),
          `${next}: the rail's ${section}`,
        ).toBeVisible();
      }
      await expect(
        page.getByRole('navigation', { name: words('settings.nav.label') }),
      ).toBeVisible();
      await expect(
        page.getByText(words('settings.appearance.theme.description')),
      ).toBeVisible();
      await expect(
        page.getByRole('radio', {
          name: words('themeSwitcher.dark'),
          exact: true,
        }),
      ).toBeVisible();
      await expect(languageButton(page, words)).toHaveAccessibleName(
        `${words('languageSwitcher.ariaLabel')}: ${languageName(next)}`,
      );
      await expect(
        page.getByRole('link', { name: words('navigation.skipToContent') }),
      ).toHaveCount(1);
      // The document says so, and so does the tab.
      await expect(page).toHaveTitle(settingsTitle(words, 'appearance'));
      const look = await documentLook(page);
      expect(look.lang).toBe(next);
      expect(look.storedLanguage).toBe(next);

      // Kept: the next load is in that language too.
      await page.reload();
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: words('settings.pages.appearance.title'),
        }),
      ).toBeVisible();
      await expect(page).toHaveTitle(settingsTitle(words, 'appearance'));
    }
  });

  test('picking the language that is shown changes nothing', async ({
    page,
  }) => {
    await openSettings(page, 'appearance');
    await languageButton(page).click();
    await page.getByRole('menuitem', { name: languageName('en') }).click();

    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(languageButton(page)).toBeFocused();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: t('settings.pages.appearance.title'),
      }),
    ).toBeVisible();
  });

  test('the menu works from the keyboard: open, arrow to a language, choose it', async ({
    page,
  }) => {
    await openSettings(page, 'appearance');
    await languageButton(page).focus();
    await page.keyboard.press('Enter');

    // It opens on the language in use.
    await expect(
      page.getByRole('menuitem', { name: languageName('en') }),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('menuitem', { name: languageName('de') }),
    ).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: tIn.de('settings.pages.appearance.title'),
      }),
    ).toBeVisible();
    // The menu closed and the button has the keyboard again.
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(languageButton(page, tIn.de)).toBeFocused();
  });

  test("a language picked here wins over the browser's on the next visit", async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'de-DE' });
    const page = await context.newPage();
    try {
      await openSettings(page, 'appearance', tIn.de);
      await languageButton(page, tIn.de).click();
      await page.getByRole('menuitem', { name: languageName('en') }).click();
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: t('settings.pages.appearance.title'),
        }),
      ).toBeVisible();

      await page.reload();
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: t('settings.pages.appearance.title'),
        }),
      ).toBeVisible();
      expect((await documentLook(page)).lang).toBe('en');
    } finally {
      await context.close();
    }
  });
});

test.describe('Appearance: the language of a first visit', () => {
  const visits: Array<{
    locale: string;
    language: Language;
    /** The browser's language is one the app has messages for. */
    languageOffered: boolean;
  }> = [
    { locale: 'de-DE', language: 'de', languageOffered: true },
    { locale: 'de-CH', language: 'de', languageOffered: true },
    { locale: 'fr-FR', language: 'fr', languageOffered: true },
    { locale: 'fr-CA', language: 'fr', languageOffered: true },
    { locale: 'en-GB', language: 'en', languageOffered: true },
    // A language the app does not offer is shown in English.
    { locale: 'ja-JP', language: 'en', languageOffered: false },
  ];

  for (const { locale, language, languageOffered } of visits) {
    test.describe(`a browser set to ${locale}`, () => {
      test.use({ locale });

      test(`shows the app in ${languageName(language)} from the first load, and stores nothing`, async ({
        page,
      }) => {
        const words = tIn[language];
        await page.goto('/settings/appearance');

        await expect(
          page.getByRole('heading', {
            level: 1,
            name: words('settings.pages.appearance.title'),
          }),
        ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
        await expect(
          page.getByRole('link', {
            name: words('navigation.sections.proxies'),
            exact: true,
          }),
        ).toBeVisible();
        await expect(languageButton(page, words)).toHaveAccessibleName(
          `${words('languageSwitcher.ariaLabel')}: ${languageName(language)}`,
        );
        await expect(page).toHaveTitle(settingsTitle(words, 'appearance'));
        // The browser's language is followed, not copied into a preference.
        expect((await documentLook(page)).storedLanguage).toBeNull();
        // The document names the language of what it shows (a regional
        // variant of it is fine: de-CH on a German page).
        if (languageOffered) {
          expect((await documentLook(page)).lang).toMatch(
            new RegExp(`^${language}(-|$)`, 'i'),
          );
        }
      });
    });
  }
});

// =============================================================================
// The browser tab's title
// =============================================================================

test.describe('The title of the browser tab', () => {
  test('names the page and the app, and changes with the page', async ({
    page,
    api,
  }) => {
    const session = await api.startSession('titled');
    const pages: Array<{ path: string; title: string }> = [
      {
        path: '/sessions',
        title: tabTitle(t('navigation.sections.sessions')),
      },
      // The open session names its tab, so that several stay apart in the
      // browser's list of tabs.
      { path: `/sessions/${session.id}`, title: tabTitle(session.name) },
      {
        path: '/sessions/999999',
        title: tabTitle(t('viewer.gone.title')),
      },
      {
        path: '/proxies',
        title: tabTitle(t('navigation.sections.proxies')),
      },
      {
        path: '/secrets',
        title: tabTitle(t('navigation.sections.secrets')),
      },
      { path: '/settings/general', title: settingsTitle(t, 'general') },
      { path: '/settings/appearance', title: settingsTitle(t, 'appearance') },
      { path: '/settings/ai-access', title: settingsTitle(t, 'ai-access') },
    ];

    for (const { path, title } of pages) {
      await page.goto(path);
      await expect(page, path).toHaveTitle(title);
    }

    // In the app, too: the title follows a click without a reload.
    await page.goto('/sessions');
    await page
      .getByRole('link', {
        name: t('navigation.sections.proxies'),
        exact: true,
      })
      .click();
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.proxies')));
    await page
      .getByRole('link', {
        name: t('navigation.sections.settings'),
        exact: true,
      })
      .click();
    await expect(page).toHaveTitle(settingsTitle(t, 'general'));
    await page
      .getByRole('link', { name: t('settings.pages.aiAccess.title') })
      .click();
    await expect(page).toHaveTitle(settingsTitle(t, 'ai-access'));
    await page.goBack();
    await expect(page).toHaveTitle(settingsTitle(t, 'general'));
  });

  for (const language of ['de', 'fr'] as const) {
    test(`is worded in ${languageName(language)} on every page for a browser set to it`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ locale: language });
      const page = await context.newPage();
      const words = tIn[language];
      try {
        const titles: Array<[string, string]> = [
          ['/sessions', tabTitle(words('navigation.sections.sessions'))],
          ['/proxies', tabTitle(words('navigation.sections.proxies'))],
          ['/secrets', tabTitle(words('navigation.sections.secrets'))],
          ['/settings/general', settingsTitle(words, 'general')],
          ['/settings/appearance', settingsTitle(words, 'appearance')],
          ['/settings/ai-access', settingsTitle(words, 'ai-access')],
        ];
        for (const [path, title] of titles) {
          await page.goto(path);
          await expect(page, `${language} ${path}`).toHaveTitle(title);
        }
      } finally {
        await context.close();
      }
    });
  }
});
