import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Opens the menu that has the focus with Enter and puts the focus on its first
 * item, `first`. Which item takes the focus on opening depends on what the
 * page last saw, the keyboard or the pointer, so the first item is reached with
 * Home once the menu has the focus. The menu moves the focus a moment after a
 * key (not at once), so a next key waits for the focus to arrive: the caller
 * does the same after each arrow.
 */
export async function openMenuWithKeyboard(
  page: Page,
  first: Locator,
): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('menu').and(page.locator(':focus-within')),
  ).toBeVisible();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
}
