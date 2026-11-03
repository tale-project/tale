import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TabInfo } from '@/lib/live-view';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import type { PageDialogInfo } from '../lib/live-state';
import { PageDialogs } from './page-dialogs';

const tabs: TabInfo[] = [
  {
    id: 1,
    url: 'https://shop.example.com/cart',
    title: 'Your cart',
    loading: false,
    active: true,
  },
  {
    id: 2,
    url: 'https://news.example.org/story',
    title: '',
    loading: false,
    active: false,
  },
  {
    id: 3,
    url: 'about:blank',
    title: 'Your bank says: send money now',
    loading: false,
    active: false,
  },
];

const dialog = (
  overrides: Partial<PageDialogInfo> & Pick<PageDialogInfo, 'kind'>,
): PageDialogInfo => ({
  id: 1,
  tab: 1,
  message: 'Are you sure?',
  default: '',
  ...overrides,
});

/** The dialogs of the page, as the live view keeps them: an answer takes the dialog away. */
function setup(initial: PageDialogInfo[]) {
  const answered = vi.fn();
  const returnFocus = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(initial);
    return (
      <PageDialogs
        dialogs={open}
        tabs={tabs}
        onAnswer={(id, accept, text) => {
          answered(id, accept, text);
          setOpen((current) => current.filter((item) => item.id !== id));
        }}
        returnFocus={returnFocus}
      />
    );
  }
  return { ...renderApp(<Harness />), answered, returnFocus };
}

describe('PageDialogs', () => {
  it('shows an alert with its message, kept as the page wrote it', async () => {
    setup([dialog({ kind: 'alert', message: 'Saved!\nSee you soon.' })]);
    const box = await screen.findByRole('dialog', { name: 'The page says' });
    expect(within(box).getByText(/Saved!/).textContent).toBe(
      'Saved!\nSee you soon.',
    );
    expect(within(box).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('has what the page says as its description, so that a screen reader reads it', async () => {
    setup([
      dialog({
        kind: 'alert',
        message: 'Your session expired. Please sign in again.',
      }),
    ]);
    const box = await screen.findByRole('dialog', { name: 'The page says' });
    expect(box).toHaveAccessibleDescription(
      'Your session expired. Please sign in again.',
    );
  });

  it('says who speaks with the host of the tab, never with the title the page gave itself', async () => {
    setup([dialog({ kind: 'alert' })]);
    const box = await screen.findByRole('dialog');
    expect(within(box).getByText('shop.example.com')).toBeVisible();
    expect(within(box).queryByText('Your cart')).toBeNull();
  });

  it('says the host of a tab that has no title, too', async () => {
    setup([dialog({ kind: 'alert', tab: 2 })]);
    expect(await screen.findByText('news.example.org')).toBeVisible();
  });

  it('names no speaker for a tab that is no web page, whatever title its page gave itself', async () => {
    setup([dialog({ kind: 'alert', tab: 3 })]);
    const box = await screen.findByRole('dialog');
    expect(within(box).queryByText(/bank/)).toBeNull();
    expect(within(box).queryByText('about:blank')).toBeNull();
  });

  it('names no speaker for a tab that is gone', async () => {
    setup([dialog({ kind: 'alert', tab: 99 })]);
    const box = await screen.findByRole('dialog');
    expect(within(box).queryByText(/example/)).toBeNull();
  });

  it('answers an alert with OK, which has the keyboard for Enter', async () => {
    const { user, answered } = setup([dialog({ kind: 'alert' })]);
    const ok = await screen.findByRole('button', { name: 'OK' });
    await waitFor(() => expect(ok).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(answered).toHaveBeenCalledExactlyOnceWith(1, true, null);
  });

  it('answers a confirm with OK or Cancel', async () => {
    const first = setup([dialog({ kind: 'confirm' })]);
    await first.user.click(await screen.findByRole('button', { name: 'OK' }));
    expect(first.answered).toHaveBeenCalledExactlyOnceWith(1, true, null);
    first.unmount();

    const second = setup([dialog({ kind: 'confirm', id: 2 })]);
    await second.user.click(
      await screen.findByRole('button', { name: 'Cancel' }),
    );
    expect(second.answered).toHaveBeenCalledExactlyOnceWith(2, false, null);
  });

  it('answers no to a confirm that is closed with Escape', async () => {
    const { user, answered } = setup([dialog({ kind: 'confirm', id: 3 })]);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(answered).toHaveBeenCalledExactlyOnceWith(3, false, null);
  });

  it('asks a prompt with its default text selected, and answers with what was typed', async () => {
    const { user, answered } = setup([
      dialog({ kind: 'prompt', message: 'Your name?', default: 'Ada' }),
    ]);
    const field = await screen.findByRole<HTMLInputElement>('textbox', {
      name: 'Your name?',
    });
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue('Ada');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(3);
    await user.keyboard('Grace{Enter}');
    expect(answered).toHaveBeenCalledExactlyOnceWith(1, true, 'Grace');
  });

  it('asks a prompt in the words of the question, and only calls the field an answer when the page asked nothing', async () => {
    const asked = setup([
      dialog({ kind: 'prompt', message: 'Your name?', default: '' }),
    ]);
    const box = await screen.findByRole('dialog');
    expect(box).toHaveAccessibleDescription('Your name?');
    expect(
      within(box).getByRole('textbox', { name: 'Your name?' }),
    ).toBeVisible();
    expect(within(box).queryByRole('textbox', { name: 'Answer' })).toBeNull();
    asked.unmount();

    setup([dialog({ kind: 'prompt', id: 2, message: '', default: '' })]);
    expect(
      await screen.findByRole('textbox', { name: 'Answer' }),
    ).toBeVisible();
  });

  it('cancels a prompt', async () => {
    const { user, answered } = setup([
      dialog({ kind: 'prompt', message: 'Your name?', default: 'Ada' }),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(answered).toHaveBeenCalledExactlyOnceWith(1, false, 'Ada');
  });

  it('asks before a page is left, in words of its own', async () => {
    const { user, answered } = setup([
      dialog({ kind: 'beforeunload', message: '' }),
    ]);
    const box = await screen.findByRole('dialog', { name: 'Leave this page?' });
    expect(
      within(box).getByText(
        'This page asks for confirmation before you leave it.',
      ),
    ).toBeVisible();
    await user.click(within(box).getByRole('button', { name: 'Stay on page' }));
    expect(answered).toHaveBeenCalledExactlyOnceWith(1, false, null);
  });

  it('lets the page be left', async () => {
    const { user, answered } = setup([
      dialog({ kind: 'beforeunload', message: 'Unsaved changes!' }),
    ]);
    expect(await screen.findByText('Unsaved changes!')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Leave page' }));
    expect(answered).toHaveBeenCalledExactlyOnceWith(1, true, null);
  });

  it('says nothing more than the page said', async () => {
    setup([dialog({ kind: 'alert', message: '' })]);
    const box = await screen.findByRole('dialog');
    expect(box).not.toHaveAccessibleDescription();
  });

  it('asks the dialogs one at a time, in the order they came', async () => {
    const { user, answered } = setup([
      dialog({ kind: 'alert', id: 1, message: 'First' }),
      dialog({ kind: 'confirm', id: 2, message: 'Second' }),
    ]);
    expect(await screen.findByText('First')).toBeVisible();
    expect(screen.queryByText('Second')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(answered).toHaveBeenCalledExactlyOnceWith(1, true, null);
    expect(await screen.findByText('Second')).toBeVisible();
    expect(screen.queryByText('First')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(answered).toHaveBeenLastCalledWith(2, false, null);
  });

  it('starts the next dialog afresh, with its own default text', async () => {
    const { user } = setup([
      dialog({ kind: 'prompt', id: 1, message: 'First?', default: 'one' }),
      dialog({ kind: 'prompt', id: 2, message: 'Second?', default: 'two' }),
    ]);
    const field = await screen.findByRole('textbox', { name: 'First?' });
    expect(field).toHaveValue('one');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Second?' })).toHaveValue(
        'two',
      ),
    );
  });

  it('gives the keyboard back to the page once a dialog is gone', async () => {
    const { user, returnFocus } = setup([dialog({ kind: 'alert' })]);
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(returnFocus).toHaveBeenCalled());
  });

  it('has no accessibility violations for an alert, a prompt and a question about leaving', async () => {
    setup([
      dialog({ kind: 'prompt', id: 1, message: 'Name?', default: 'Ada' }),
    ]);
    await screen.findByRole('dialog');
    await checkAccessibility(document.body);
  });

  it('has no accessibility violations for a question about leaving', async () => {
    setup([dialog({ kind: 'beforeunload', id: 1, message: '' })]);
    await screen.findByRole('dialog');
    await checkAccessibility(document.body);
  });
});
