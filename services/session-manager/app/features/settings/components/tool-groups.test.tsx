import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { TOOL_GROUPS } from '../lib/tools';
import { ToolGroups } from './tool-groups';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

/** A group's row: the `details` its name is the summary of. */
function group(name: string): HTMLDetailsElement {
  const summary = screen.getByText(name).closest('summary');
  const details = summary?.closest('details');
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error(`No tool group named ${name}`);
  }
  return details;
}

// Each group is a native `<details>`: the browser, not this code, opens a
// focused summary on Enter and Space and puts it in the tab order. jsdom
// models neither, so the keyboard is looked at in a real browser.
describe('ToolGroups', () => {
  it('lists the five groups of the README, each with how many tools it holds', () => {
    renderApp(<ToolGroups />);

    const rows = [
      ['Overview and settings', '3 tools'],
      ['Sessions', '11 tools'],
      ['Proxies', '5 tools'],
      ["A running session's browser", '17 tools'],
      ['Secrets and notes', '6 tools'],
    ] as const;
    for (const [name, count] of rows) {
      expect(within(group(name)).getByText(count)).toBeInTheDocument();
    }
  });

  it('keeps the tool names out of the way until a group is opened', async () => {
    const { user } = renderApp(<ToolGroups />);
    expect(screen.getByText('get_secret')).not.toBeVisible();

    await user.click(screen.getByText('Secrets and notes'));

    expect(group('Secrets and notes')).toHaveAttribute('open');
    expect(screen.getByText('get_secret')).toBeVisible();
    expect(
      screen.getByText(
        'List, read, add, change and delete secrets. An assistant can also type one value into a page without seeing it.',
      ),
    ).toBeVisible();
    // The other groups stay as they were.
    expect(screen.getByText('list_sessions')).not.toBeVisible();
  });

  it('names every tool of an opened group, in the README’s order', async () => {
    const { user } = renderApp(<ToolGroups />);
    await user.click(screen.getByText("A running session's browser"));

    const names = within(group("A running session's browser"))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(names).toEqual(
      TOOL_GROUPS.find((entry) => entry.key === 'browser')?.tools,
    );
    expect(names).toContain('handle_dialog');
  });

  it('opens from anywhere in a row: its padding is the summary’s, so a click in it is a click on the control', async () => {
    const { user } = renderApp(<ToolGroups />);
    const proxies = group('Proxies');
    const summary = proxies.querySelector('summary');
    if (summary === null) throw new Error('The group has no summary.');

    // On the box of the summary itself, not on its words.
    await user.click(summary);
    expect(proxies).toHaveAttribute('open');

    // What a click on the `<details>` outside its summary does is nothing (a
    // browser opens it only from the summary), so the row may carry no padding
    // of its own: whatever it had would be a part of the row that is dead. jsdom
    // lays nothing out, so this is read in the classes.
    expect(proxies.className).not.toMatch(/(^|\s)p[xytrbl]?-\d/);
    expect(summary.closest('details')).toBe(proxies);
  });

  it('can have several groups open at once', async () => {
    const { user } = renderApp(<ToolGroups />);
    await user.click(screen.getByText('Proxies'));
    await user.click(screen.getByText('Sessions'));
    expect(group('Proxies')).toHaveAttribute('open');
    expect(group('Sessions')).toHaveAttribute('open');
  });

  it('counts in the language of the person, one tool and many', async () => {
    expect(i18n.t('settings:aiAccess.tools.count', { count: 1 })).toBe(
      '1 tool',
    );
    await i18n.changeLanguage('de');
    expect(i18n.t('settings:aiAccess.tools.count', { count: 1 })).toBe(
      '1 Tool',
    );
    expect(i18n.t('settings:aiAccess.tools.count', { count: 11 })).toBe(
      '11 Tools',
    );
    await i18n.changeLanguage('fr');
    expect(i18n.t('settings:aiAccess.tools.count', { count: 1 })).toBe(
      '1 outil',
    );
    expect(i18n.t('settings:aiAccess.tools.count', { count: 17 })).toBe(
      '17 outils',
    );
  });

  it('reads in German', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderApp(<ToolGroups />);

    expect(
      within(group('Übersicht und Einstellungen')).getByText('3 Tools'),
    ).toBeInTheDocument();
    expect(
      within(group('Der Browser einer laufenden Sitzung')).getByText(
        '17 Tools',
      ),
    ).toBeInTheDocument();
    expect(
      within(group('Secrets und Notizen')).getByText('6 Tools'),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations closed or open', async () => {
    const view = renderApp(<ToolGroups />);
    await checkAccessibility(view);
    await view.user.click(screen.getByText('Sessions'));
    await view.user.click(screen.getByText("A running session's browser"));
    await checkAccessibility(view);
  });
});
