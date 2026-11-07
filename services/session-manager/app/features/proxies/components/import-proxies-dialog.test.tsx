import { useToast } from '@tale/ui/use-toast';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import {
  proxy,
  importDuplicate,
  importError,
  importResult,
} from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderHookApp, renderInShell } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import {
  ImportProxiesDialog,
  type ImportProxiesDialogProps,
} from './import-proxies-dialog';

// jsdom has no layout, so a footer that stays in reach cannot be measured here
// (the real browser run of the page does): the contract is that the dialog asks
// the library for it.
const asked = vi.hoisted(() => ({
  stickyFooter: [] as (boolean | undefined)[],
}));
vi.mock('@tale/ui/dialog/form-dialog', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@tale/ui/dialog/form-dialog')>();
  return {
    ...original,
    FormDialog: (props: Parameters<typeof original.FormDialog>[0]) => {
      asked.stickyFooter.push(props.stickyFooter);
      return <original.FormDialog {...props} />;
    },
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  asked.stickyFooter.length = 0;
  await resetLanguage();
});

/** The notices on screen, with the variant the toast has no role to say. */
function watchToasts() {
  const { result } = renderHookApp(() => useToast());
  return () =>
    openToasts(result.current.toasts).map(({ title, variant }) => ({
      title,
      variant,
    }));
}

function renderDialog(props: Partial<ImportProxiesDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const onShow = vi.fn();
  const view = renderInShell(
    <ImportProxiesDialog
      open
      onOpenChange={onOpenChange}
      onShow={onShow}
      {...props}
    />,
  );
  return { ...view, onOpenChange, onShow };
}

const list = () =>
  screen.getByRole('textbox', { name: 'Proxies, one per line' });
const importButton = () =>
  screen.getByRole('button', { name: 'Import proxies' });
const fileInput = () => screen.getByLabelText('Proxy list file (.txt)');

type User = ReturnType<typeof renderDialog>['user'];

async function paste(user: User, text: string) {
  await user.click(list());
  await user.paste(text);
}

const LIST = '1.2.3.4:8080:ada:secret\n198.51.100.4:8080\n1.2.3.4:99999:ada:x';

/** A report with one of everything: added, repeated, refused. */
const REPORT = importResult({
  added: [proxy({ id: 20 })],
  duplicates: [importDuplicate({ line: 2 })],
  errors: [importError({ line: 3 })],
});

describe('ImportProxiesDialog', () => {
  it('opens on the list, with the ways to give one and the default type', () => {
    renderDialog();

    expect(
      screen.getByRole('dialog', { name: 'Import proxies' }),
    ).toBeVisible();
    expect(list()).toHaveFocus();
    // Examples, not formats: the label says one per line, the footer offers a
    // file, and nothing else stands above the list.
    expect(list()).toHaveAttribute(
      'placeholder',
      'proxy.example.com:8080\nproxy.example.com:8080:user:pass\nsocks5://proxy.example.com:1080',
    );
    expect(screen.getByRole('dialog')).not.toHaveAccessibleDescription();
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'HTTP' })).toBeChecked();
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Proxy type');
  });

  it('keeps Choose file and the shortcut in the footer, before Cancel and Import', () => {
    renderDialog();
    const choose = screen.getByRole('button', { name: 'Choose file' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const submit = screen.getByRole('button', { name: 'Import proxies' });
    expect(choose.parentElement?.parentElement).toContainElement(cancel);
    expect(choose.parentElement?.parentElement).toContainElement(submit);
    expect(
      list().compareDocumentPosition(choose) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      choose.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the buttons in reach while a long report scrolls, in the form and in the report', async () => {
    installFakeApi({ 'POST /proxies/import': REPORT });
    const { user } = renderDialog();
    expect(asked.stickyFooter.at(-1)).toBe(true);

    await paste(user, LIST);
    await user.click(importButton());
    await screen.findByRole('status');

    expect(asked.stickyFooter.at(-1)).toBe(true);
    expect(asked.stickyFooter.every(Boolean)).toBe(true);
  });

  it('shows nothing while closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not call a fresh form invalid when its field is blurred once', async () => {
    renderDialog();

    await act(async () => {
      list().blur();
      list().focus();
    });

    expect(
      screen.queryByText('Paste at least one proxy or choose a .txt file.'),
    ).not.toBeInTheDocument();
  });

  describe('importing', () => {
    it('sends the list with the chosen type and shows the report in place of the form', async () => {
      const api = installFakeApi({ 'POST /proxies/import': REPORT });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(screen.getByRole('radio', { name: 'HTTPS' }));
      await user.click(importButton());

      const summary = await screen.findByRole('status');
      expect(summary).toHaveTextContent('1 proxy added, 1 duplicate, 1 error');
      expect(api.callsTo('POST /proxies/import')[0]?.body).toEqual({
        text: LIST,
        defaultScheme: 'https',
      });
      // The report replaces the form, and reads out: it holds the focus.
      expect(summary).toHaveFocus();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Import proxies' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit list' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Done' })).toBeVisible();
    });

    it('lists the lines that could not be read, with their masked text and why', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          errors: [
            importError({ line: 3 }),
            importError({
              line: 7,
              input: 'example.com',
              message: 'missing port (expected host:port)',
              code: 'missing_port',
              params: {},
            }),
          ],
        }),
      });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      await screen.findByRole('status');
      expect(screen.getByText("2 lines couldn't be read")).toBeVisible();
      expect(screen.getByText('Line 3')).toBeVisible();
      // The input as the server masked it: no password in sight.
      expect(screen.getByText('1.2.3.4:99999:***:***')).toBeVisible();
      expect(
        screen.getByText(
          'Invalid port 99999. A port is a number from 1 to 65535.',
        ),
      ).toBeVisible();
      expect(screen.getByText('Line 7')).toBeVisible();
      expect(screen.getByText('example.com')).toBeVisible();
      expect(
        screen.getByText('The port is missing. Write the proxy as host:port.'),
      ).toBeVisible();
    });

    it('shows the sentence of the backend for a reason it has no words for', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          errors: [
            importError({
              code: 'a_reason_from_the_future',
              message: 'Something new is wrong with this line',
              params: {},
            }),
          ],
        }),
      });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      expect(
        await screen.findByText('Something new is wrong with this line'),
      ).toBeVisible();
    });

    it('folds the duplicates away and shows each with a way to the proxy it repeats', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          duplicates: [
            importDuplicate({ line: 2 }),
            importDuplicate({
              line: 5,
              display: 'socks5://ada@gate.example.com:7000',
              existingId: 8,
            }),
          ],
        }),
      });
      const { user, onShow } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      const toggle = await screen.findByText('2 duplicates', {
        selector: 'summary',
      });
      const chip = () =>
        screen.getByText('http://198.51.100.4:8080', { selector: 'code' });
      expect(chip()).not.toBeVisible();

      await user.click(toggle);

      expect(chip()).toBeVisible();
      expect(screen.getByText('Line 5')).toBeVisible();
      await user.click(
        screen.getByRole('button', {
          name: 'Show in list socks5://ada@gate.example.com:7000',
        }),
      );
      // The proxy it stands for, without the login: that is what the table finds.
      expect(onShow).toHaveBeenCalledWith('gate.example.com:7000');
    });

    it('opens the lines that could not be read, which are what there is to fix', async () => {
      installFakeApi({ 'POST /proxies/import': REPORT });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      await screen.findByRole('status');
      expect(screen.getByText("1 line couldn't be read")).toBeVisible();
      expect(screen.getByText('1.2.3.4:99999:***:***')).toBeVisible();
    });

    it('says nothing was added when the same list is imported again', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          duplicates: [
            importDuplicate({ line: 1 }),
            importDuplicate({ line: 2 }),
            importDuplicate({ line: 3 }),
          ],
        }),
      });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      expect(await screen.findByRole('status')).toHaveTextContent(
        'No proxies added, 3 duplicates',
      );
      expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
    });

    it('counts in the plural forms of the language', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          added: [proxy({ id: 1 }), proxy({ id: 2 })],
          duplicates: [
            importDuplicate({ line: 3 }),
            importDuplicate({ line: 4 }),
          ],
          errors: [importError({ line: 5 }), importError({ line: 6 })],
        }),
      });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      expect(await screen.findByRole('status')).toHaveTextContent(
        '2 proxies added, 2 duplicates, 2 errors',
      );
    });

    it('goes back to the form with the list kept, ready to correct it', async () => {
      installFakeApi({ 'POST /proxies/import': REPORT });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());
      await screen.findByRole('status');
      await user.click(screen.getByRole('button', { name: 'Edit list' }));

      expect(list()).toHaveValue(LIST);
      expect(list()).toHaveFocus();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('closes from the report with Done', async () => {
      installFakeApi({ 'POST /proxies/import': REPORT });
      const { user, onOpenChange } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());
      await screen.findByRole('status');
      await user.click(screen.getByRole('button', { name: 'Done' }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('imports with Ctrl+Enter and with Cmd+Enter, from the list', async () => {
      const api = installFakeApi({ 'POST /proxies/import': REPORT });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.keyboard('{Control>}{Enter}{/Control}');

      await screen.findByRole('status');
      expect(api.callsTo('POST /proxies/import')).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Edit list' }));
      await user.click(list());
      await user.keyboard('{Meta>}{Enter}{/Meta}');
      await waitFor(() =>
        expect(api.callsTo('POST /proxies/import')).toHaveLength(2),
      );
    });

    it('keeps a plain Enter for a new line', async () => {
      const api = installFakeApi({ 'POST /proxies/import': REPORT });
      const { user } = renderDialog();

      await user.click(list());
      await user.keyboard('a:1{Enter}b:2');

      expect(list()).toHaveValue('a:1\nb:2');
      expect(api.calls).toHaveLength(0);
    });

    it('asks for a list when none was given, and sends nothing', async () => {
      const api = installFakeApi({});
      const { user } = renderDialog();

      await user.click(importButton());

      expect(
        await screen.findByText(
          'Paste at least one proxy or choose a .txt file.',
        ),
      ).toBeVisible();
      expect(list()).toBeInvalid();
      expect(api.calls).toHaveLength(0);

      await user.type(list(), 'a:1');
      await waitFor(() => expect(list()).toBeValid());
    });

    it('tells a failure in one toast and keeps the list for another try', async () => {
      installFakeApi({
        'POST /proxies/import': failure(
          500,
          'internal',
          'The server is on fire',
        ),
      });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      expect(
        await screen.findByText("Couldn't import the proxies"),
      ).toBeVisible();
      // A code the app has no words for: not the backend's own English.
      expect(
        screen.getByText('Something went wrong. Try again.'),
      ).toBeVisible();
      expect(
        screen.queryByText('The server is on fire'),
      ).not.toBeInTheDocument();
      expect(list()).toHaveValue(LIST);
      expect(importButton()).toBeEnabled();
    });

    it('is busy while the list is imported', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      installFakeApi({
        'POST /proxies/import': async () => {
          await gate;
          return REPORT;
        },
      });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      await waitFor(() =>
        expect(importButton()).toHaveAttribute('aria-busy', 'true'),
      );
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

      release();
      await screen.findByRole('status');
    });
  });

  describe('choosing a file', () => {
    const txt = (content: string, name = 'list.txt') =>
      new File([content], name, { type: 'text/plain' });

    it('puts the text of the file in the list and says what was read', async () => {
      const { user } = renderDialog();

      await user.upload(fileInput(), txt('a:1\n\n# note\nb:2\nc:3\n'));

      await waitFor(() =>
        expect(list()).toHaveValue('a:1\n\n# note\nb:2\nc:3\n'),
      );
      // Blank lines are not counted; a comment line is a line of the file.
      expect(screen.getByText('list.txt · 4 lines')).toBeVisible();
    });

    it('tells it as a notice, so a screen reader hears that a file was read', async () => {
      const { user } = renderDialog();

      await user.upload(fileInput(), txt('a:1\nb:2'));

      expect(await screen.findByRole('status')).toHaveTextContent(
        'list.txt · 2 lines',
      );
    });

    it('keeps the line count in the words however long the name of the file is', async () => {
      const { user } = renderDialog();
      const name =
        'proxies-with-a-rather-long-file-name-for-the-provider-export.txt';

      await user.upload(fileInput(), txt('a:1\nb:2\nc:3', name));

      expect(await screen.findByRole('status')).toHaveTextContent(
        `${name} · 3 lines`,
      );
    });

    it('counts the lines of a file written on Windows', async () => {
      const { user } = renderDialog();

      await user.upload(fileInput(), txt('a:1\r\nb:2\r\n'));

      expect(await screen.findByText('list.txt · 2 lines')).toBeVisible();
    });

    it('reads a single line as one line', async () => {
      const { user } = renderDialog();

      await user.upload(fileInput(), txt('a:1'));

      expect(await screen.findByText('list.txt · 1 line')).toBeVisible();
    });

    it('replaces what was in the list, and imports the file as given', async () => {
      const api = installFakeApi({ 'POST /proxies/import': REPORT });
      const { user } = renderDialog();
      await paste(user, 'old:1');

      await user.upload(fileInput(), txt('new:1\nnew:2'));
      await waitFor(() => expect(list()).toHaveValue('new:1\nnew:2'));
      await user.click(importButton());

      await screen.findByRole('status');
      expect(api.callsTo('POST /proxies/import')[0]?.body).toMatchObject({
        text: 'new:1\nnew:2',
      });
    });

    it('can load the same file again after the list was edited', async () => {
      const { user } = renderDialog();
      const file = txt('a:1');

      await user.upload(fileInput(), file);
      await waitFor(() => expect(list()).toHaveValue('a:1'));
      await user.type(list(), ' edited');
      await user.upload(fileInput(), file);

      await waitFor(() => expect(list()).toHaveValue('a:1'));
    });

    it('opens the chooser from the button', async () => {
      const { user } = renderDialog();
      const click = vi.spyOn(fileInput(), 'click');

      await user.click(screen.getByRole('button', { name: 'Choose file' }));

      expect(click).toHaveBeenCalledOnce();
    });

    it('says when the file cannot be read, and leaves the list as it was', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { user } = renderDialog();
      await paste(user, 'keep:1');
      const broken = txt('x');
      Object.defineProperty(broken, 'text', {
        value: () => Promise.reject(new Error('unreadable')),
      });

      await user.upload(fileInput(), broken);

      expect(await screen.findByText("Couldn't read list.txt.")).toBeVisible();
      expect(list()).toHaveValue('keep:1');
      expect(list()).toBeInvalid();
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('saying how to import from the keyboard', () => {
    it('says which keys, in the words the platform uses', () => {
      renderDialog();

      expect(list()).toHaveAccessibleDescription('Ctrl + Enter to import');
    });

    it('names the Command key on a Mac', () => {
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
      renderDialog();

      expect(list()).toHaveAccessibleDescription('⌘ Enter to import');
    });

    it('says it in German and French', async () => {
      await showLanguage('de');
      const german = renderDialog();
      expect(
        screen.getByRole('textbox', { name: 'Proxies, einer pro Zeile' }),
      ).toHaveAccessibleDescription('Ctrl + Enter zum Importieren');
      german.unmount();

      await showLanguage('fr');
      renderDialog();
      expect(
        screen.getByRole('textbox', { name: 'Proxys, un par ligne' }),
      ).toHaveAccessibleDescription('Ctrl + Enter pour importer');
    });
  });

  describe('closing with a list typed', () => {
    const askedToDiscard = () => vi.spyOn(globalThis, 'confirm');

    it('asks before a list is thrown away, and goes on closing when the answer is yes', async () => {
      const confirm = askedToDiscard().mockReturnValue(true);
      const { user, onOpenChange } = renderDialog();
      await paste(user, LIST);

      await user.keyboard('{Escape}');

      expect(confirm).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('keeps the dialog and the list when the answer is no', async () => {
      const confirm = askedToDiscard().mockReturnValue(false);
      const { user, onOpenChange } = renderDialog();
      await paste(user, LIST);

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(confirm).toHaveBeenCalledOnce();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(list()).toHaveValue(LIST);
    });

    it('does not ask when nothing was typed', async () => {
      const confirm = askedToDiscard();
      const { user, onOpenChange } = renderDialog();

      await user.keyboard('{Escape}');

      expect(confirm).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not ask once the list was imported: the report is what is left', async () => {
      const confirm = askedToDiscard();
      installFakeApi({ 'POST /proxies/import': REPORT });
      const { user, onOpenChange } = renderDialog();
      await paste(user, LIST);
      await user.click(importButton());
      await screen.findByRole('status');

      await user.click(screen.getByRole('button', { name: 'Done' }));

      expect(confirm).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('asks as well when a file filled the list: it is as much to lose as a paste', async () => {
      const confirm = askedToDiscard().mockReturnValue(true);
      const { user, onOpenChange } = renderDialog();
      await user.upload(
        fileInput(),
        new File(['a:1\nb:2'], 'list.txt', { type: 'text/plain' }),
      );
      await waitFor(() => expect(list()).toHaveValue('a:1\nb:2'));

      await user.keyboard('{Escape}');

      expect(confirm).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('closing after an import', () => {
    const added = (count: number) =>
      Array.from({ length: count }, (_, index) => proxy({ id: 20 + index }));

    it('closes at once, with a notice, when every line was added', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({ added: added(2) }),
      });
      const { user, onOpenChange } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(await screen.findByText('2 proxies added')).toBeVisible();
      // No report to read: nothing needed a second look.
      expect(
        screen.queryByRole('button', { name: 'Edit list' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/0 duplicates/)).not.toBeInTheDocument();
    });

    it('words the notice for a single proxy in the singular', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({ added: added(1) }),
      });
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      expect(await screen.findByText('1 proxy added')).toBeVisible();
    });

    it('keeps the report when a line repeated a proxy of the pool, however many were added', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          added: added(2),
          duplicates: [importDuplicate({ line: 3 })],
        }),
      });
      const { user, onOpenChange } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      expect(await screen.findByRole('status')).toHaveTextContent(
        '2 proxies added, 1 duplicate',
      );
      expect(onOpenChange).not.toHaveBeenCalled();
      // Told in the report, not in a notice besides it.
      expect(screen.queryByText('2 proxies added')).not.toBeInTheDocument();
    });

    it('keeps the report when a line is refused, however many were added', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          added: added(2),
          errors: [importError({ line: 3 })],
        }),
      });
      const { user, onOpenChange } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      expect(await screen.findByRole('status')).toHaveTextContent(
        '2 proxies added, 1 error',
      );
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('keeps the report when nothing was added', async () => {
      installFakeApi({ 'POST /proxies/import': importResult() });
      const { user, onOpenChange } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      expect(await screen.findByRole('status')).toHaveTextContent(
        /^No proxies added$/,
      );
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('counts the notice in the plural forms of the language', async () => {
      await showLanguage('de');
      installFakeApi({
        'POST /proxies/import': importResult({ added: added(2) }),
      });
      const { user } = renderDialog();

      await user.click(
        screen.getByRole('textbox', { name: 'Proxies, einer pro Zeile' }),
      );
      await user.paste(LIST);
      await user.click(
        screen.getByRole('button', { name: 'Proxies importieren' }),
      );

      expect(await screen.findByText('2 Proxies hinzugefügt')).toBeVisible();
    });

    it('counts the notice in the singular of the language', async () => {
      await showLanguage('fr');
      installFakeApi({
        'POST /proxies/import': importResult({ added: added(1) }),
      });
      const { user } = renderDialog();

      await user.click(
        screen.getByRole('textbox', { name: 'Proxys, un par ligne' }),
      );
      await user.paste(LIST);
      await user.click(
        screen.getByRole('button', { name: 'Importer des proxys' }),
      );

      expect(await screen.findByText('1 proxy ajouté')).toBeVisible();
    });
  });

  describe('telling what was added', () => {
    const added = (count: number) =>
      Array.from({ length: count }, (_, index) => proxy({ id: 20 + index }));

    it('tells the page when proxies were added, whether the dialog closes or keeps its report', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          added: added(2),
          duplicates: [importDuplicate({ line: 3 })],
        }),
      });
      const onAdded = vi.fn();
      const { user, onOpenChange } = renderDialog({ onAdded });

      await paste(user, LIST);
      await user.click(importButton());

      await screen.findByRole('status');
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onAdded.mock.calls[0]?.[0].added).toHaveLength(2);
    });

    it('tells it once for an import that added every line, and closes', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({ added: added(2) }),
      });
      const onAdded = vi.fn();
      const { user, onOpenChange } = renderDialog({ onAdded });

      await paste(user, LIST);
      await user.click(importButton());

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(onAdded).toHaveBeenCalledTimes(1);
    });

    it('tells nothing when nothing was added', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          duplicates: [importDuplicate({ line: 2 })],
        }),
      });
      const onAdded = vi.fn();
      const { user } = renderDialog({ onAdded });

      await paste(user, LIST);
      await user.click(importButton());

      await screen.findByRole('status');
      expect(onAdded).not.toHaveBeenCalled();
    });

    it('says in a warning, not a plain notice, that only part of the list went in', async () => {
      installFakeApi({ 'POST /proxies/import': REPORT });
      const toasts = watchToasts();
      const { user } = renderDialog({
        purpose: {
          title: 'No free proxy available',
          intro: 'Add proxies and the session will start automatically.',
          submitText: 'Add proxies',
        },
        onShow: undefined,
      });

      await paste(user, LIST);
      await user.click(screen.getByRole('button', { name: 'Add proxies' }));

      await waitFor(() =>
        expect(toasts()).toEqual([
          { title: '1 proxy added, 1 duplicate, 1 error', variant: 'warning' },
        ]),
      );
    });

    it('says in a success, not a warning, that every line went in', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({ added: added(2) }),
      });
      const toasts = watchToasts();
      const { user } = renderDialog();

      await paste(user, LIST);
      await user.click(importButton());

      await waitFor(() =>
        expect(toasts()).toMatchObject([
          { title: '2 proxies added', variant: 'success' },
        ]),
      );
    });
  });

  describe('opened because an action needs a proxy', () => {
    const PURPOSE = {
      title: 'No free proxy available',
      intro:
        'Every session needs a proxy of its own, and none is free right now. Add proxies and the session will start automatically.',
      submitText: 'Add proxies',
    };
    const added = (count: number) =>
      Array.from({ length: count }, (_, index) => proxy({ id: 20 + index }));

    function renderPurposeful(props: Partial<ImportProxiesDialogProps> = {}) {
      const onAdded = vi.fn();
      const view = renderDialog({
        purpose: PURPOSE,
        onShow: undefined,
        onAdded,
        ...props,
      });
      return { ...view, onAdded };
    }

    it('says why it opened and what comes next, with the same form as the page has', () => {
      renderPurposeful();

      const dialog = screen.getByRole('dialog', {
        name: 'No free proxy available',
      });
      expect(dialog).toHaveTextContent(PURPOSE.intro);
      expect(list()).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Choose file' })).toBeVisible();
      expect(screen.getByRole('radio', { name: 'HTTP' })).toBeChecked();
      expect(screen.getByRole('button', { name: 'Add proxies' })).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Import proxies' }),
      ).not.toBeInTheDocument();
    });

    it('sends the list and closes as soon as one proxy was added, with the plain notice for a clean import', async () => {
      const api = installFakeApi({
        'POST /proxies/import': importResult({ added: added(3) }),
      });
      const { user, onOpenChange, onAdded } = renderPurposeful();

      await paste(user, LIST);
      await user.click(screen.getByRole('radio', { name: 'SOCKS5' }));
      await user.click(screen.getByRole('button', { name: 'Add proxies' }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(api.callsTo('POST /proxies/import')[0]?.body).toEqual({
        text: LIST,
        defaultScheme: 'socks5',
      });
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(onAdded.mock.calls[0]?.[0].added).toHaveLength(3);
      expect(await screen.findByText('3 proxies added')).toBeVisible();
    });

    it('closes on one proxy even when other lines repeated or failed, and tells what happened in the notice', async () => {
      installFakeApi({ 'POST /proxies/import': REPORT });
      const { user, onOpenChange, onAdded } = renderPurposeful();

      await paste(user, LIST);
      await user.click(screen.getByRole('button', { name: 'Add proxies' }));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(onAdded).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByText('1 proxy added, 1 duplicate, 1 error'),
      ).toBeVisible();
    });

    it('stays open with the report when nothing was added, so the lines can be corrected', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          errors: [importError({ line: 1 })],
        }),
      });
      const { user, onOpenChange, onAdded } = renderPurposeful();

      await paste(user, LIST);
      await user.click(screen.getByRole('button', { name: 'Add proxies' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        'No proxies added, 1 error',
      );
      expect(onAdded).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Edit list' })).toBeVisible();
    });

    it('is given up with Cancel and with Escape, and has added nothing then', async () => {
      const { user, onOpenChange, onAdded } = renderPurposeful();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
      await user.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledTimes(2);
      expect(onAdded).not.toHaveBeenCalled();
    });

    it('offers no way to a table it is not part of when told of none', async () => {
      installFakeApi({
        'POST /proxies/import': importResult({
          duplicates: [importDuplicate({ line: 2 })],
        }),
      });
      const { user } = renderPurposeful();

      await paste(user, LIST);
      await user.click(screen.getByRole('button', { name: 'Add proxies' }));
      await user.click(
        await screen.findByText('1 duplicate', { selector: 'summary' }),
      );

      expect(
        screen.getByText('http://198.51.100.4:8080', { selector: 'code' }),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: /Show in list/ }),
      ).not.toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
      renderPurposeful();
      await checkAccessibility(document.body);
    });
  });

  it('closes on Cancel and on Escape', async () => {
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('speaks German, down to the plural forms and the reasons', async () => {
    await showLanguage('de');
    installFakeApi({ 'POST /proxies/import': REPORT });
    const { user } = renderDialog();

    expect(
      screen.getByRole('dialog', { name: 'Proxies importieren' }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('textbox', { name: 'Proxies, einer pro Zeile' }),
    );
    await user.paste(LIST);
    await user.click(
      screen.getByRole('button', { name: 'Proxies importieren' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      '1 Proxy hinzugefügt, 1 Duplikat, 1 Fehler',
    );
    expect(
      screen.getByText('1 Zeile konnte nicht gelesen werden'),
    ).toBeVisible();
    expect(screen.getByText('Zeile 3')).toBeVisible();
    expect(
      screen.getByText(
        'Ungültiger Port 99999. Ein Port ist eine Zahl von 1 bis 65535.',
      ),
    ).toBeVisible();
  });

  it('speaks French', async () => {
    await showLanguage('fr');
    installFakeApi({
      'POST /proxies/import': importResult({
        added: [proxy({ id: 1 }), proxy({ id: 2 })],
        duplicates: [importDuplicate()],
      }),
    });
    const { user } = renderDialog();

    await user.click(
      screen.getByRole('textbox', { name: 'Proxys, un par ligne' }),
    );
    await user.paste(LIST);
    await user.click(
      screen.getByRole('button', { name: 'Importer des proxys' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      '2 proxys ajoutés, 1 doublon',
    );
  });

  it('has no accessibility violations (the form)', async () => {
    renderDialog();
    await checkAccessibility(document.body);
  });

  it('has no accessibility violations (the form with an error)', async () => {
    const { user } = renderDialog();
    await user.click(importButton());
    await screen.findByText('Paste at least one proxy or choose a .txt file.');

    await checkAccessibility(document.body);
  });

  it('has no accessibility violations (the report, everything open)', async () => {
    installFakeApi({ 'POST /proxies/import': REPORT });
    const { user } = renderDialog();
    await paste(user, LIST);
    await user.click(importButton());
    await user.click(
      await screen.findByText('1 duplicate', { selector: 'summary' }),
    );
    expect(
      within(screen.getByRole('dialog')).getByText('Line 2'),
    ).toBeVisible();

    await checkAccessibility(document.body);
  });
});
