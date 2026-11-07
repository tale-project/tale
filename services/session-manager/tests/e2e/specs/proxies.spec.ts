import type { Locator, Page } from '@playwright/test';

import type { Scheme } from '../../../lib/api/schemas';
import { MAX_PROXY_IMPORT, MAX_PROXY_LINE } from '../../../lib/proxy-limits';
import { violationsOf } from '../helpers/axe';
import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { fill, literally, t } from '../helpers/i18n';
import { answerNativeQuestions } from '../helpers/proxies-confirm';
import { cutOff, failRequests, freezeLists } from '../helpers/proxies-faults';
import { openMenuWithKeyboard } from '../helpers/proxies-keyboard';
import {
  addressText,
  badge,
  countryText,
  eventually,
  importedText,
  importSummary,
  pingText,
  poolSummary,
  SHORTCUT_HINT,
  ProxiesPage,
  refusalText,
  showingAll,
  showingSome,
  soon,
  untilStill,
} from '../helpers/proxies-page';
import {
  importChecked,
  removeAllProxies,
  SLOW_CHECK_MS,
  sessionHolding,
  untilChecked,
} from '../helpers/proxies-scene';
import { format, leaksOf } from '../helpers/proxies-text';
import { tabTitle, tIn } from '../helpers/settings-i18n';

// Asking for `api` empties the manager (the fixture resets it): every test of
// the file starts from an empty pool, whether it uses `api` or not.
test.beforeEach(async ({ api }) => {
  expect(await api.proxies()).toEqual([]);
});

// ---------------------------------------------------------------------------
// The empty pool
// ---------------------------------------------------------------------------

test.describe('an empty pool', () => {
  test('says so, and offers the two ways to add proxies from one button', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.proxies')));

    await soon(
      proxies.table.getByRole('heading', {
        level: 2,
        name: t('proxies.empty.title'),
      }),
    ).toBeVisible();
    await soon(proxies.table).toContainText(t('proxies.empty.description'));

    // One button, which opens a menu of the two ways: by hand, or from a list.
    await expect(proxies.addMenu).toBeVisible();
    await proxies.addMenu.click();
    await expect(
      page.getByRole('menuitem', { name: t('proxies.actions.addProxy') }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: t('proxies.actions.importProxies') }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // Nothing to search, to check or to count: the toolbar is not there.
    await expect(proxies.search).toHaveCount(0);
    await expect(proxies.checkAll).toHaveCount(0);
    await expect(
      page.getByText(poolSummary({ proxies: 0, free: 0 })),
    ).toHaveCount(0);
    expect(await api.proxies()).toEqual([]);
  });

  test('the Add proxy dialog is opened from the menu, and Cancel and Escape leave it without adding or asking', async ({
    page,
    api,
  }) => {
    const questions = answerNativeQuestions(page);
    const proxies = await ProxiesPage.open(page);

    const dialog = await proxies.openAddDialog();
    await proxies.expectOpen(dialog);
    await expect(dialog).toContainText(t('proxies.add.description'));
    await expect(dialog).toContainText(t('proxies.add.hint'));
    await expect(dialog).toContainText(t('proxies.scheme.hint'));
    await expect(proxies.addField).toBeFocused();
    await expect(proxies.schemeChoice(dialog, 'http')).toBeChecked();

    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();
    await expect(proxies.addMenu).toBeFocused();

    await proxies.openAddDialog();
    await proxies.addField.fill('10.0.0.1:8080');
    await page.keyboard.press('Escape');
    await soon(dialog).toBeHidden();

    // What was typed is gone with the dialog: it opens empty again. One line
    // is no work to ask about (the Import dialog asks about a pasted list).
    await proxies.openAddDialog();
    await expect(proxies.addField).toHaveValue('');
    expect(questions.asked).toEqual([]);
    expect(await api.proxies()).toEqual([]);
  });

  test('the first proxy replaces the empty state, with a notice and the counts', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.add('10.0.0.1:8080');

    await soon(proxies.addDialog).toBeHidden();
    await soon(proxies.toast(t('proxies.toasts.added'))).toBeVisible();
    await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
    await soon(
      proxies.table.getByRole('heading', { name: t('proxies.empty.title') }),
    ).toHaveCount(0);
    await proxies.expectSummary({ proxies: 1, free: 1 });
    await expect(proxies.footer).toHaveText(showingAll(1));
    await expect(proxies.search).toBeEnabled();
    expect(await api.proxies()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Adding one proxy
// ---------------------------------------------------------------------------

interface Sample {
  title: string;
  input: string;
  /** The host and port the row is named by. */
  hostPort: string;
  /** The muted front of the row's address: the type, then the user name. */
  front: string;
  stored: {
    scheme: string;
    host: string;
    port: number;
    username: string | null;
    hasPassword: boolean;
  };
  password?: string;
}

const PASSWORD = 'tr0ub4dor-pw';

/** What the API answers for a line it will not print, not even masked. */
const NOT_PRINTED = '***';

const FORMATS: Sample[] = [
  {
    title: 'host:port',
    input: '10.0.0.1:8080',
    hostPort: '10.0.0.1:8080',
    front: 'http://',
    stored: {
      scheme: 'http',
      host: '10.0.0.1',
      port: 8080,
      username: null,
      hasPassword: false,
    },
  },
  {
    title: 'host:port:user:pass',
    input: `10.0.0.2:8081:alice:${PASSWORD}`,
    hostPort: '10.0.0.2:8081',
    front: 'http://alice@',
    stored: {
      scheme: 'http',
      host: '10.0.0.2',
      port: 8081,
      username: 'alice',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'user:pass@host:port',
    input: `bob:${PASSWORD}@10.0.0.3:8082`,
    hostPort: '10.0.0.3:8082',
    front: 'http://bob@',
    stored: {
      scheme: 'http',
      host: '10.0.0.3',
      port: 8082,
      username: 'bob',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'user:pass:host:port',
    input: `carol:${PASSWORD}:10.0.0.4:8083`,
    hostPort: '10.0.0.4:8083',
    front: 'http://carol@',
    stored: {
      scheme: 'http',
      host: '10.0.0.4',
      port: 8083,
      username: 'carol',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'host:port@user:pass',
    input: `10.0.0.5:8084@dave:${PASSWORD}`,
    hostPort: '10.0.0.5:8084',
    front: 'http://dave@',
    stored: {
      scheme: 'http',
      host: '10.0.0.5',
      port: 8084,
      username: 'dave',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'http://user:pass@host:port',
    input: `http://erin:${PASSWORD}@10.0.0.6:8085`,
    hostPort: '10.0.0.6:8085',
    front: 'http://erin@',
    stored: {
      scheme: 'http',
      host: '10.0.0.6',
      port: 8085,
      username: 'erin',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'https://user:pass@host:port',
    input: `https://frank:${PASSWORD}@10.0.0.7:8443`,
    hostPort: '10.0.0.7:8443',
    front: 'https://frank@',
    stored: {
      scheme: 'https',
      host: '10.0.0.7',
      port: 8443,
      username: 'frank',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'socks5://user:pass@host:port',
    input: `socks5://gina:${PASSWORD}@10.0.0.8:1080`,
    hostPort: '10.0.0.8:1080',
    front: 'socks5://gina@',
    stored: {
      scheme: 'socks5',
      host: '10.0.0.8',
      port: 1080,
      username: 'gina',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'socks5://host:port',
    input: 'socks5://10.0.0.9:1080',
    hostPort: '10.0.0.9:1080',
    front: 'socks5://',
    stored: {
      scheme: 'socks5',
      host: '10.0.0.9',
      port: 1080,
      username: null,
      hasPassword: false,
    },
  },
  {
    title: 'scheme://host:port:user:pass',
    input: `socks5://10.0.0.10:1081:hank:${PASSWORD}`,
    hostPort: '10.0.0.10:1081',
    front: 'socks5://hank@',
    stored: {
      scheme: 'socks5',
      host: '10.0.0.10',
      port: 1081,
      username: 'hank',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'socks5h://host:port, which is SOCKS5',
    input: 'socks5h://10.0.0.11:1082',
    hostPort: '10.0.0.11:1082',
    front: 'socks5://',
    stored: {
      scheme: 'socks5',
      host: '10.0.0.11',
      port: 1082,
      username: null,
      hasPassword: false,
    },
  },
  {
    title: 'an IPv6 address in brackets',
    input: '[2001:db8::1]:8080',
    hostPort: '[2001:db8::1]:8080',
    front: 'http://',
    stored: {
      scheme: 'http',
      host: '2001:db8::1',
      port: 8080,
      username: null,
      hasPassword: false,
    },
  },
  {
    title: 'an IPv6 address in brackets with credentials',
    input: `[2001:db8::2]:8080:iris:${PASSWORD}`,
    hostPort: '[2001:db8::2]:8080',
    front: 'http://iris@',
    stored: {
      scheme: 'http',
      host: '2001:db8::2',
      port: 8080,
      username: 'iris',
      hasPassword: true,
    },
    password: PASSWORD,
  },
  {
    title: 'a host name in capitals, which is lower-cased',
    input: 'Proxy.Example.COM:8080',
    hostPort: 'proxy.example.com:8080',
    front: 'http://',
    stored: {
      scheme: 'http',
      host: 'proxy.example.com',
      port: 8080,
      username: null,
      hasPassword: false,
    },
  },
  {
    title: 'credentials with percent-encoded characters',
    input: 'http://us%40er:p%40ss%3Aword@10.0.0.12:8080',
    hostPort: '10.0.0.12:8080',
    front: 'http://us@er@',
    stored: {
      scheme: 'http',
      host: '10.0.0.12',
      port: 8080,
      username: 'us@er',
      hasPassword: true,
    },
    password: 'p@ss:word',
  },
];

test.describe('adding one proxy', () => {
  for (const sample of FORMATS) {
    test(`accepts ${sample.title}`, async ({ page, api }) => {
      const proxies = await ProxiesPage.open(page);
      await proxies.add(sample.input);

      await soon(proxies.addDialog).toBeHidden();
      await soon(proxies.toast(t('proxies.toasts.added'))).toBeVisible();
      const row = proxies.row(sample.hostPort);
      await soon(row.address).toHaveText(
        addressText(sample.front, sample.hostPort),
      );
      await expect(row.session).toHaveText(t('proxies.session.free'));
      await eventually(badge(row, 'ok')).toBeVisible();

      // The row says what the backend stored, and the page shows no more of it.
      const [stored] = await api.proxies();
      expect(stored).toMatchObject(sample.stored);
      await expect(row.exit).toContainText(stored.check.exitIp ?? 'no exit IP');
      if (sample.password !== undefined) {
        expect(JSON.stringify(await api.proxies())).not.toContain(
          sample.password,
        );
        expect(
          await leaksOf(page, { 'the password': sample.password }),
        ).toEqual([]);
      }
    });
  }

  test('uses the type chosen in the dialog for a proxy that gives none', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const chosen: Array<[Scheme, string]> = [
      ['https', '10.0.0.1:8080'],
      ['socks5', '10.0.0.2:1080:alice:pw1'],
    ];
    for (const [scheme, input] of chosen) {
      await proxies.addAccepted(input, scheme);
    }
    await soon(proxies.row('10.0.0.1:8080').address).toHaveText(
      addressText('https://', '10.0.0.1:8080'),
    );
    await soon(proxies.row('10.0.0.2:1080').address).toHaveText(
      addressText('socks5://alice@', '10.0.0.2:1080'),
    );
    expect((await api.proxies()).map((proxy) => proxy.scheme).sort()).toEqual([
      'https',
      'socks5',
    ]);
  });

  test('keeps the type a proxy gives itself, whatever the dialog has chosen', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.add('http://10.0.0.1:8080', 'socks5');
    await soon(proxies.row('10.0.0.1:8080').address).toHaveText(
      addressText('http://', '10.0.0.1:8080'),
    );
    expect((await api.proxies()).map((proxy) => proxy.scheme)).toEqual([
      'http',
    ]);
  });

  test('the type choice starts on HTTP every time the dialog opens', async ({
    page,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const dialog = await proxies.openAddDialog();
    await proxies.schemeChoice(dialog, 'socks5').click();
    await expect(proxies.schemeChoice(dialog, 'socks5')).toBeChecked();
    await page.keyboard.press('Escape');
    await soon(dialog).toBeHidden();

    await proxies.openAddDialog();
    await expect(proxies.schemeChoice(dialog, 'http')).toBeChecked();
  });

  test('refuses an empty line beside the field, without asking the backend', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(request.url());
    });

    await proxies.openAddDialog();
    for (const blank of ['', '   ']) {
      await proxies.addField.fill(blank);
      await proxies.addSubmit.click();
      await soon(proxies.addDialog.getByRole('alert')).toHaveText(
        t('proxies.add.required'),
      );
      await expect(proxies.addField).toHaveAttribute('aria-invalid', 'true');
      await expect(proxies.addDialog).toBeVisible();
    }
    // Typing takes the refusal back.
    await proxies.addField.fill('1');
    await expect(proxies.addDialog.getByRole('alert')).toHaveCount(0);
    expect(posts).toEqual([]);
    expect(await api.proxies()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What the Add dialog refuses
// ---------------------------------------------------------------------------

interface Refusal {
  title: string;
  input: string;
  /** The reason the backend gives (`proxies.parseErrors.<code>`). */
  code: string;
  params?: Record<string, string | number>;
}

const REFUSALS: Refusal[] = [
  { title: 'no port', input: '10.0.0.1', code: 'missing_port' },
  { title: 'an empty port', input: '10.0.0.1:', code: 'missing_port' },
  {
    title: 'a port above 65535',
    input: '10.0.0.1:99999',
    code: 'invalid_port_value',
    params: { port: '99999' },
  },
  {
    title: 'port 0',
    input: '10.0.0.1:0',
    code: 'invalid_port_value',
    params: { port: '0' },
  },
  {
    title: 'a bad port in a line with credentials',
    input: '10.0.0.1:99999:bob:hunter2',
    code: 'invalid_port_value',
    params: { port: '99999' },
  },
  {
    title: 'a port that is no number',
    input: '10.0.0.1:abc',
    code: 'invalid_port',
  },
  {
    // The credentials are shaped like an address, so the reason does not name
    // the number it might have taken for a port.
    title: 'a port out of range, after credentials that look like an address',
    input: 'http://john.doe:1234@1.2.3.4:99999',
    code: 'invalid_port',
  },
  {
    title: 'three parts it cannot read',
    input: '10.0.0.1:8080:bob',
    code: 'unparsed_form',
  },
  {
    title: 'a type it does not know',
    input: 'ftp://10.0.0.1:21',
    code: 'unsupported_scheme',
  },
  {
    title: 'SOCKS4',
    input: 'socks4://10.0.0.1:1080',
    code: 'unsupported_socks4',
  },
  {
    title: 'SOCKS4a',
    input: 'socks4a://10.0.0.1:1080',
    code: 'unsupported_socks4a',
  },
  { title: 'a space inside', input: '10.0.0.1:80 80', code: 'whitespace' },
  { title: 'a path', input: 'http://10.0.0.1:80/path', code: 'url_has_path' },
  {
    title: 'an IPv6 address without brackets',
    input: '2001:db8::1:8080',
    code: 'ipv6_needs_brackets',
  },
  {
    title: 'a bracketed IPv6 address without a port',
    input: '[2001:db8::1]',
    code: 'missing_port_ipv6',
  },
  {
    title: 'an IPv6 bracket that is not closed',
    input: '[2001:db8::1',
    code: 'unterminated_bracket',
  },
  {
    title: 'an IPv6 address that is none',
    input: '[zzz]:80',
    code: 'invalid_ipv6',
  },
  {
    title: 'characters after the IPv6 address',
    input: '[::1]x:80',
    code: 'invalid_after_ipv6',
  },
  { title: 'no host', input: ':8080', code: 'missing_host' },
  { title: 'a bad IPv4 address', input: '999.1.1.1:80', code: 'invalid_ipv4' },
  {
    title: 'a bad host name',
    input: 'bad_host!.com:80',
    code: 'invalid_hostname',
  },
  {
    title: 'a password without a user name',
    input: ':hunter2@10.0.0.1:80',
    code: 'password_without_username',
  },
  {
    title: 'control characters in the credentials',
    input: 'http://bob%00:hunter2@10.0.0.1:80',
    code: 'credentials_control_chars',
  },
  {
    title: 'SOCKS5 credentials that are too long',
    input: `socks5://${'u'.repeat(256)}:hunter2@10.0.0.1:80`,
    code: 'socks_credentials_too_long',
  },
  {
    title: 'a host and a user it cannot tell apart',
    input: 'a.b:80:c.d:81',
    code: 'ambiguous',
  },
  {
    title: 'no host and port in it',
    input: 'a:b:c:d',
    code: 'host_port_not_found',
  },
  {
    title: 'a URL with too many parts',
    input: 'http://10.0.0.1:80:x',
    code: 'unparsed_url_form',
  },
];

test.describe('the Add dialog refuses', () => {
  for (const refusal of REFUSALS) {
    test(`${refusal.title} (${refusal.code}), beside the field`, async ({
      page,
      api,
    }) => {
      const proxies = await ProxiesPage.open(page);
      await proxies.openAddDialog();
      await proxies.submitProxy(refusal.input);

      // The reason is the backend's, worded by the app.
      const alert = proxies.addDialog.getByRole('alert');
      await soon(alert).toHaveText(refusalText(refusal.code, refusal.params));
      await expect(proxies.addField).toHaveAttribute('aria-invalid', 'true');
      await expect(proxies.addField).toBeFocused();

      // The dialog stays, with what was typed, ready for another try.
      await expect(proxies.addDialog).toBeVisible();
      await expect(proxies.addField).toHaveValue(refusal.input);
      await expect(proxies.addSubmit).toBeEnabled();
      expect(await api.proxies()).toEqual([]);

      await proxies.addField.fill('10.0.0.1:8080');
      await expect(alert).toHaveCount(0);
      await proxies.addSubmit.click();
      await soon(proxies.addDialog).toBeHidden();
      await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
      expect(await api.proxies()).toHaveLength(1);
    });
  }
});

test.describe('a line over the limit', () => {
  test('is refused beside the field of the Add dialog, which keeps it, and nothing is added', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.openAddDialog();
    const line = 'x'.repeat(MAX_PROXY_LINE + 1);
    await proxies.submitProxy(line);

    // Said beside the field, in the app's words (the server refuses it before it reads it).
    await soon(proxies.addDialog.getByRole('alert')).toHaveText(/\S/);
    await expect(proxies.addField).toHaveAttribute('aria-invalid', 'true');
    await expect(proxies.addField).toBeFocused();
    await expect(proxies.addField).toHaveValue(line);
    expect(await api.proxies()).toEqual([]);
  });

  test('is, in a list, one of the lines that could not be read, and the others are added', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.importList(
      ['10.0.0.1:8080', 'x'.repeat(MAX_PROXY_LINE + 1), '10.0.0.2:8080'].join(
        '\n',
      ),
    );
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 2, duplicates: 0, errors: 1 }),
    );
    await expect(
      proxies.importDialog.getByRole('listitem').filter({
        hasText: fill(t('proxies.result.line'), { line: 2 }),
      }),
    ).toContainText(refusalText('line_too_long', { max: MAX_PROXY_LINE }));
    expect(await api.proxies()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

test.describe('a duplicate', () => {
  test('is refused in the Add dialog, which names the proxy that is in the pool and shows it', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080', '10.0.0.3:8080');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(3);

    // Another type of the same host and port is the same proxy.
    await proxies.add('socks5://10.0.0.2:8080');
    const alert = proxies.addDialog.getByRole('alert');
    await soon(alert).toHaveText(
      fill(t('proxies.add.duplicateOf'), { proxy: 'http://10.0.0.2:8080' }),
    );
    await expect(proxies.addField).toHaveAttribute('aria-invalid', 'true');
    expect(await api.proxies()).toHaveLength(3);

    // Show in list closes the dialog and narrows the table to that proxy.
    await proxies.addDialog
      .getByRole('button', { name: t('proxies.add.show') })
      .click();
    await soon(proxies.addDialog).toBeHidden();
    await expect(proxies.search).toHaveValue('10.0.0.2:8080');
    await expect(proxies.rows).toHaveCount(1);
    await expect(proxies.row('10.0.0.2:8080').row).toBeVisible();
    await expect(proxies.footer).toHaveText(showingSome(1, 3));
    await expect(proxies.clearSearch).toBeVisible();
  });

  test('is told apart from a proxy with other credentials, which is a proxy of its own', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.addAccepted('10.0.0.1:8080:alice:first-pw');
    await expect(proxies.rows).toHaveCount(1);

    // Same host, port and user, another password: another upstream session.
    await proxies.addAccepted('10.0.0.1:8080:alice:second-pw');
    // Same host and port without credentials: yet another.
    await proxies.addAccepted('10.0.0.1:8080');
    await expect(proxies.rows).toHaveCount(3);

    // The very same credentials are the same proxy, and the refusal names
    // the one that is there by its address (the password is nowhere in it).
    await proxies.add('alice:first-pw@10.0.0.1:8080');
    await soon(proxies.addDialog.getByRole('alert')).toHaveText(
      fill(t('proxies.add.duplicateOf'), {
        proxy: 'http://alice@10.0.0.1:8080',
      }),
    );
    expect(await api.proxies()).toHaveLength(3);
    await page.keyboard.press('Escape');
    await soon(proxies.addDialog).toBeHidden();
    expect(
      await leaksOf(page, {
        'the first password': 'first-pw',
        'the second password': 'second-pw',
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Importing a list
// ---------------------------------------------------------------------------

test.describe('importing a list', () => {
  test('reports what was added, repeated and refused, line by line, and the pool matches', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(1);

    const lines = [
      '# my list', // 1: a comment
      '', // 2
      '10.0.0.2:8080', // 3: added
      '10.0.0.2:8080', // 4: repeats line 3
      '10.0.0.1:8080', // 5: is in the pool already
      `bob:${PASSWORD}@10.0.0.3:8081`, // 6: added, with credentials
      `10.0.0.4:99999:carol:${PASSWORD}`, // 7: the port is out of range
      '10.0.0.5', // 8: no port
      'socks4://10.0.0.6:1080', // 9: a type nothing here speaks
      `[2001:db8::1]:8080:iris:${PASSWORD}`, // 10: added, IPv6
      'x'.repeat(MAX_PROXY_LINE + 1), // 11: too long a line
      'host with space:80', // 12: spaces
      '   ', // 13: blank
      'http://john.doe:1234@1.2.3.4:99999', // 14: the port is out of range; the credentials are shaped like an address
    ];
    await proxies.importList(lines.join('\n'));

    const report = proxies.importDialog;
    const summary = report.getByRole('status');
    await soon(summary).toHaveText(
      importSummary({ added: 3, duplicates: 2, errors: 6 }),
    );
    // The outcome takes the focus from the form it replaced, for a screen reader.
    await expect(summary).toBeFocused();

    // What could not be read comes first and open, each with its line, the
    // line as far as it is safe to show, and the reason in the app's words.
    const errors = proxies.importGroup(
      format(t('proxies.result.errors'), { count: 6 }),
    );
    await expect(errors).toHaveAttribute('open', '');
    const refused: Array<[number, string, string]> = [
      [
        7,
        '10.0.0.4:99999:***:***',
        refusalText('invalid_port_value', { port: '99999' }),
      ],
      [8, NOT_PRINTED, refusalText('missing_port')],
      [9, 'socks4://10.0.0.6:1080', refusalText('unsupported_socks4')],
      [11, '***...', refusalText('line_too_long', { max: MAX_PROXY_LINE })],
      [12, '***:***', refusalText('whitespace')],
      // A user name with a dot and a password of digits is shaped like host:port,
      // so the address cannot be told from the credentials: it is hidden too, and
      // the reason does not name the number it took for a port.
      [14, 'http://***:***@***:***', refusalText('invalid_port')],
    ];
    const items = errors.getByRole('listitem');
    await expect(items).toHaveCount(refused.length);
    for (const [index, [line, masked, reason]] of refused.entries()) {
      const item = items.nth(index);
      await expect(item).toContainText(
        fill(t('proxies.result.line'), { line }),
      );
      if (masked === NOT_PRINTED) {
        // A line the API will not print at all is not printed: its number says where.
        await expect(item.locator('code')).toHaveCount(0);
        await expect(item).not.toContainText(NOT_PRINTED);
      } else {
        await expect(item.getByText(masked, { exact: true })).toBeVisible();
      }
      await expect(item).toContainText(reason);
    }

    // The repeated lines are folded away; opened, each can be shown in the list.
    const duplicates = proxies.importGroup(
      format(t('proxies.result.duplicates'), { count: 2 }),
    );
    await expect(duplicates).not.toHaveAttribute('open', '');
    await report
      .getByText(format(t('proxies.result.duplicates'), { count: 2 }), {
        exact: true,
      })
      .click();
    const repeats = duplicates.getByRole('listitem');
    await expect(repeats).toHaveCount(2);
    await expect(repeats.nth(0)).toContainText(
      fill(t('proxies.result.line'), { line: 4 }),
    );
    await expect(repeats.nth(0)).toContainText('http://10.0.0.2:8080');
    await expect(repeats.nth(1)).toContainText(
      fill(t('proxies.result.line'), { line: 5 }),
    );
    await expect(repeats.nth(1)).toContainText('http://10.0.0.1:8080');

    // Neither the passwords, nor the user name of a broken line, nor the whole of it, are on the page.
    expect(
      await leaksOf(page, {
        'the password': PASSWORD,
        'the user name of the broken URL': 'john.doe',
      }),
    ).toEqual([]);
    expect(await leaksOf(page, { 'the long line': 'x'.repeat(200) })).toEqual(
      [],
    );

    await report
      .getByRole('button', { name: t('proxies.result.done') })
      .click();
    await soon(report).toBeHidden();

    // The pool is what the report says: the proxy that was there, and three more.
    await expect(proxies.rows).toHaveCount(4);
    for (const hostPort of [
      '10.0.0.1:8080',
      '10.0.0.2:8080',
      '10.0.0.3:8081',
      '[2001:db8::1]:8080',
    ]) {
      await expect(proxies.row(hostPort).row).toBeVisible();
    }
    await proxies.expectSummary({ proxies: 4, free: 4 });
    await expect(proxies.footer).toHaveText(showingAll(4));
    const pool = await api.proxies();
    expect(pool.map((proxy) => `${proxy.host}:${proxy.port}`).sort()).toEqual([
      '10.0.0.1:8080',
      '10.0.0.2:8080',
      '10.0.0.3:8081',
      '2001:db8::1:8080',
    ]);
    expect(JSON.stringify(pool)).not.toContain(PASSWORD);
    expect(await leaksOf(page, { 'the password': PASSWORD })).toEqual([]);
  });

  test('Edit list returns to the list as it was typed, and Done leaves', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const text = ['10.0.0.1:8080', '10.0.0.2'].join('\n');
    await proxies.importList(text);
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 1, duplicates: 0, errors: 1 }),
    );

    await proxies.importDialog
      .getByRole('button', { name: t('proxies.result.back') })
      .click();
    await expect(proxies.importField).toHaveValue(text);
    await expect(proxies.importField).toBeFocused();
    await expect(
      proxies.importDialog.getByRole('button', {
        name: t('proxies.import.chooseFile'),
      }),
    ).toBeVisible();

    // Fixing the broken line and importing again adds only that one.
    await proxies.importField.fill(
      ['10.0.0.1:8080', '10.0.0.2:8080'].join('\n'),
    );
    await proxies.importSubmit.click();
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 1, duplicates: 1, errors: 0 }),
    );
    await proxies.importDialog
      .getByRole('button', { name: t('proxies.result.done') })
      .click();
    await soon(proxies.importDialog).toBeHidden();
    await expect(proxies.rows).toHaveCount(2);
    expect(await api.proxies()).toHaveLength(2);
  });

  test('an import that added every line closes with a notice, and the same list again is all duplicates', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const text = [
      '10.0.0.1:8080',
      `bob:${PASSWORD}@10.0.0.2:8081`,
      'socks5://10.0.0.3:1080',
    ].join('\n');

    // Nothing was repeated or refused: there is no report to read.
    await proxies.importList(text);
    await soon(proxies.importDialog).toBeHidden();
    await soon(proxies.toast(importedText(3))).toBeVisible();
    await expect(
      proxies.toast(format(t('proxies.toasts.importedDetail'), { count: 3 })),
    ).toBeVisible();
    await expect(proxies.rows).toHaveCount(3);
    await proxies.dismissNotice(importedText(3));

    // The list again: every line is a duplicate, which a report says.
    await proxies.importList(text);
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 0, duplicates: 3, errors: 0 }),
    );
    // Nothing was refused, so there is no list of errors, only the folded one.
    await expect(
      proxies.importDialog.getByText(
        format(t('proxies.result.errors'), { count: 0 }),
      ),
    ).toHaveCount(0);
    await proxies.importDialog
      .getByRole('button', { name: t('proxies.result.done') })
      .click();
    await expect(proxies.rows).toHaveCount(3);
    expect(await api.proxies()).toHaveLength(3);
  });

  test('a list of broken lines adds nothing and leaves the pool empty', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.openImportDialog();
    await proxies.importField.fill(
      ['10.0.0.1', 'ftp://10.0.0.2:21', '10.0.0.3:abc'].join('\n'),
    );
    await proxies.importSubmit.click();
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 0, duplicates: 0, errors: 3 }),
    );
    await proxies.importDialog
      .getByRole('button', { name: t('proxies.result.done') })
      .click();
    await soon(proxies.importDialog).toBeHidden();
    await expect(
      proxies.table.getByRole('heading', { name: t('proxies.empty.title') }),
    ).toBeVisible();
    expect(await api.proxies()).toEqual([]);
  });

  test('gives the lines without a type the one chosen in the dialog', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.importList(
      ['10.0.0.1:8080', 'http://10.0.0.2:8080', 'socks5://10.0.0.3:1080'].join(
        '\n',
      ),
      'https',
    );
    await soon(proxies.importDialog).toBeHidden();
    await soon(proxies.row('10.0.0.1:8080').address).toHaveText(
      addressText('https://', '10.0.0.1:8080'),
    );
    await expect(proxies.row('10.0.0.2:8080').address).toHaveText(
      addressText('http://', '10.0.0.2:8080'),
    );
    await expect(proxies.row('10.0.0.3:1080').address).toHaveText(
      addressText('socks5://', '10.0.0.3:1080'),
    );
    expect(
      Object.fromEntries(
        (await api.proxies()).map((proxy) => [proxy.host, proxy.scheme]),
      ),
    ).toEqual({
      '10.0.0.1': 'https',
      '10.0.0.2': 'http',
      '10.0.0.3': 'socks5',
    });
  });

  test('asks for a list when there is none', async ({ page, api }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.openImportDialog();
    for (const blank of ['', ' \n \n']) {
      await proxies.importField.fill(blank);
      await proxies.importSubmit.click();
      await soon(proxies.importDialog.getByRole('alert')).toHaveText(
        t('proxies.import.required'),
      );
      await expect(proxies.importDialog).toBeVisible();
    }
    expect(await api.proxies()).toEqual([]);
  });

  test('imports with Ctrl+Enter from the list, which says so under it', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.openImportDialog();
    await expect(proxies.importDialog.getByText(SHORTCUT_HINT)).toBeVisible();
    await proxies.importField.fill('10.0.0.1:8080\n10.0.0.2:8080');
    await proxies.importField.press('Control+Enter');
    await soon(proxies.importDialog).toBeHidden();
    await soon(proxies.toast(importedText(2))).toBeVisible();
    expect(await api.proxies()).toHaveLength(2);
  });

  test('reads a .txt file as it comes from a provider: a byte order mark, CRLF, comments', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.openImportDialog();
    const bom = '﻿';
    const text = [
      `${bom}# provider export`,
      `10.0.0.1:8080:bob:${PASSWORD}`,
      '',
      '10.0.0.2:8080',
      '10.0.0.3',
      '',
    ].join('\r\n');
    await proxies.importDialog
      .getByLabel(t('proxies.import.fileInput'))
      .setInputFiles({
        name: 'export.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(text, 'utf8'),
      });

    // The file's name and how many lines it holds (blank ones do not count).
    await soon(
      proxies.importDialog.getByText(
        format(t('proxies.import.fileLoaded'), {
          name: 'export.txt',
          count: 4,
        }),
      ),
    ).toBeVisible();
    // The mark is gone and the line breaks are the textarea's own.
    await expect(proxies.importField).toHaveValue(
      /^# provider export\n10\.0\.0\.1:8080:bob:/,
    );
    await proxies.importSubmit.click();

    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 2, duplicates: 0, errors: 1 }),
    );
    // The broken line is the fifth of the file: counted as the file counts.
    await expect(
      proxies.importDialog.getByRole('listitem').filter({
        hasText: fill(t('proxies.result.line'), { line: 5 }),
      }),
    ).toContainText(refusalText('missing_port'));
    expect(await leaksOf(page, { 'the password': PASSWORD })).toEqual([]);
    expect(await api.proxies()).toHaveLength(2);
  });

  test('"Show in list" of a repeated line narrows the table to that proxy', async ({
    page,
    api,
  }) => {
    // A user name with an "@" makes the display `http://us@er@host:port`.
    const line = `http://us%40er:${PASSWORD}@10.0.0.9:8080`;
    await importChecked(api, line, '10.0.0.8:8080');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(2);

    await proxies.importList(line);
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 0, duplicates: 1, errors: 0 }),
    );
    await proxies.importDialog
      .getByText(format(t('proxies.result.duplicates'), { count: 1 }), {
        exact: true,
      })
      .click();
    await proxies.importDialog
      .getByRole('button', {
        name: new RegExp(`^${literally(t('proxies.result.show')).source}`),
      })
      .click();

    await soon(proxies.importDialog).toBeHidden();
    await expect(proxies.search).toHaveValue('10.0.0.9:8080');
    await expect(proxies.rows).toHaveCount(1);
    await expect(proxies.row('10.0.0.9:8080').address).toHaveText(
      addressText('http://us@er@', '10.0.0.9:8080'),
    );
  });

  test('a long list is imported whole, with the right counts', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const valid = Array.from(
      { length: 150 },
      (_, index) => `10.1.${Math.floor(index / 100)}.${(index % 100) + 1}:8080`,
    );
    const broken = Array.from(
      { length: 12 },
      (_, index) => `10.2.0.${index + 1}`,
    );
    const repeated = valid.slice(0, 9);
    const list = [...valid, ...broken, ...repeated].join('\n');

    await proxies.importList(list);
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 150, duplicates: 9, errors: 12 }),
    );
    await expect(
      proxies.importDialog.getByText(
        format(t('proxies.result.errors'), { count: 12 }),
      ),
    ).toBeVisible();
    await expect(
      proxies
        .importGroup(format(t('proxies.result.errors'), { count: 12 }))
        .getByRole('listitem'),
    ).toHaveCount(12);
    await proxies.importDialog
      .getByRole('button', { name: t('proxies.result.done') })
      .click();
    await soon(proxies.importDialog).toBeHidden();
    await proxies.expectSummary({ proxies: 150, free: 150 });
    expect(await api.meta()).toMatchObject({ counts: { proxies: 150 } });
  });

  test('a list larger than the server takes is refused in a notice, and the list stays for another try', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.openImportDialog();
    // One character past the most a list can have, read from a file as a provider's export is.
    await proxies.importDialog
      .getByLabel(t('proxies.import.fileInput'))
      .setInputFiles({
        name: 'export.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('x'.repeat(MAX_PROXY_IMPORT + 1), 'utf8'),
      });
    await soon(
      proxies.importDialog.getByText(
        format(t('proxies.import.fileLoaded'), {
          name: 'export.txt',
          count: 1,
        }),
      ),
    ).toBeVisible();
    await proxies.importSubmit.click();

    await soon(proxies.toast(t('proxies.toasts.importFailed'))).toBeVisible();
    await expect(proxies.importDialog).toBeVisible();
    await expect(proxies.importSubmit).toBeEnabled();
    await expect(proxies.importField).not.toHaveValue('');
    expect(await api.proxies()).toEqual([]);
  });

  test('lists fifty lines of a kind in its report and counts the rest, for the lines that could not be read and for the repeated ones', async ({
    page,
    api,
  }) => {
    // How many lines of one kind the report lists before it counts the others.
    const LISTED = 50;
    const repeated = Array.from(
      { length: LISTED + 5 },
      (_, index) => `10.1.0.${index + 1}:8080`,
    );
    const unreadable = Array.from(
      { length: LISTED + 10 },
      (_, index) => `10.2.0.${index + 1}`,
    );
    await api.importProxies(repeated.join('\n'));
    const proxies = await ProxiesPage.open(page);

    await proxies.importList([...repeated, ...unreadable].join('\n'));
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({
        added: 0,
        duplicates: repeated.length,
        errors: unreadable.length,
      }),
    );

    // The lines that could not be read come first and open: fifty, then the rest counted.
    const errors = proxies.importGroup(
      format(t('proxies.result.errors'), { count: unreadable.length }),
    );
    const unread = errors.getByRole('listitem');
    await expect(unread).toHaveCount(LISTED + 1);
    await expect(unread.first()).toContainText(
      fill(t('proxies.result.line'), { line: repeated.length + 1 }),
    );
    await expect(unread.nth(LISTED - 1)).toContainText(
      fill(t('proxies.result.line'), { line: repeated.length + LISTED }),
    );
    await expect(unread.last()).toHaveText(
      format(t('proxies.result.more'), { count: unreadable.length - LISTED }),
    );

    // The repeated ones are folded away; opened, they stop at fifty as well.
    const duplicates = format(t('proxies.result.duplicates'), {
      count: repeated.length,
    });
    await proxies.importDialog.getByText(duplicates, { exact: true }).click();
    const again = proxies.importGroup(duplicates).getByRole('listitem');
    await expect(again).toHaveCount(LISTED + 1);
    await expect(again.nth(LISTED - 1)).toContainText(
      fill(t('proxies.result.line'), { line: LISTED }),
    );
    await expect(again.last()).toHaveText(
      format(t('proxies.result.more'), { count: repeated.length - LISTED }),
    );
    expect(await api.proxies()).toHaveLength(repeated.length);
  });
});

// ---------------------------------------------------------------------------
// Leaving the import dialog
// ---------------------------------------------------------------------------

test.describe('leaving the import dialog', () => {
  const LIST = ['10.0.0.1:8080', '10.0.0.2:8080'].join('\n');
  // The corner of the page: outside the dialog, on the dimmed page behind it.
  const OUTSIDE = { x: 1, y: 1 } as const;
  const WAYS: Array<{
    name: string;
    leave: (page: Page, dialog: Locator) => Promise<void>;
  }> = [
    {
      name: 'Cancel',
      leave: (_page, dialog) =>
        dialog
          .getByRole('button', { name: t('common.actions.cancel') })
          .click(),
    },
    { name: 'Escape', leave: (page) => page.keyboard.press('Escape') },
    {
      name: 'Close',
      leave: (_page, dialog) =>
        dialog.getByRole('button', { name: t('common.aria.close') }).click(),
    },
    {
      name: 'a click outside',
      leave: (page) => page.mouse.click(OUTSIDE.x, OUTSIDE.y),
    },
  ];

  for (const way of WAYS) {
    test(`${way.name} asks before a pasted list is thrown away: "no" keeps the list, "yes" leaves`, async ({
      page,
      api,
    }) => {
      const questions = answerNativeQuestions(page);
      const proxies = await ProxiesPage.open(page);
      const dialog = await proxies.openImportDialog();
      await proxies.expectOpen(dialog);
      await proxies.importField.fill(LIST);

      await way.leave(page, dialog);
      await expect
        .poll(() => questions.asked, { message: 'the question is asked' })
        .toEqual([t('common.discardChangesConfirm')]);
      await expect(dialog).toBeVisible();
      await expect(proxies.importField).toHaveValue(LIST);

      questions.answer(true);
      await way.leave(page, dialog);
      await soon(dialog).toBeHidden();
      expect(questions.asked).toHaveLength(2);
      expect(await api.proxies()).toEqual([]);
      await expect(proxies.addMenu).toBeFocused();
    });
  }

  test('asks nothing when no list was typed, or only blanks', async ({
    page,
  }) => {
    const questions = answerNativeQuestions(page);
    const proxies = await ProxiesPage.open(page);
    const dialog = await proxies.openImportDialog();
    await proxies.expectOpen(dialog);
    await page.keyboard.press('Escape');
    await soon(dialog).toBeHidden();

    await proxies.openImportDialog();
    await proxies.importField.fill(' \n  \n');
    await page.keyboard.press('Escape');
    await soon(dialog).toBeHidden();
    expect(questions.asked).toEqual([]);
  });

  test('asks nothing about a report, which is read and not work', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const questions = answerNativeQuestions(page);
    const proxies = await ProxiesPage.open(page);
    await proxies.importList('10.0.0.1:8080');
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 0, duplicates: 1, errors: 0 }),
    );
    await page.keyboard.press('Escape');
    await soon(proxies.importDialog).toBeHidden();
    expect(questions.asked).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

test.describe('the health of a proxy', () => {
  test('is "Checking" while a new proxy is looked at, then "Working" with its exit IP, country and ping', async ({
    page,
    control,
  }) => {
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    const proxies = await ProxiesPage.open(page);
    await proxies.add('10.0.0.7:8080');
    const row = proxies.row('10.0.0.7:8080');

    await soon(badge(row, 'checking')).toBeVisible();
    // Nothing is known of it yet; a screen reader is told so.
    await expect(row.exit).toContainText(t('proxies.unknown'));
    await expect(row.ping).toContainText(t('proxies.unknown'));
    await expect(row.session).toHaveText(t('proxies.session.free'));

    // The page keeps asking while a check runs, and shows the answer.
    await eventually(badge(row, 'ok')).toBeVisible();
    await expect(row.exit).toContainText('203.0.113.7');
    await expect(row.exit).toContainText(countryText('DE'));
    await expect(row.ping).toHaveText(pingText(42));
    await proxies.expectSummary({ proxies: 1, free: 1 });
  });

  test('shows the exit IP alone when its country is not known', async ({
    page,
    api,
    control,
  }) => {
    await control.exitIps({
      '10.0.0.1:8080': { ip: '198.51.100.9', country: null },
    });
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    const row = proxies.row('10.0.0.1:8080');
    await soon(badge(row, 'ok')).toBeVisible();
    await expect(row.exit).toHaveText('198.51.100.9');
  });

  test('is "Not working" with the reason when the check fails, and such a proxy is never given to a session', async ({
    page,
    api,
    control,
  }) => {
    const reason = 'the proxy rejected the credentials';
    await control.exitIps({ '10.0.0.2:8080': { error: reason } });
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080', '10.0.0.3:8080');
    const proxies = await ProxiesPage.open(page);

    const failing = proxies.row('10.0.0.2:8080');
    await soon(failing.health).toContainText(t('proxies.health.failed'));
    await expect(failing.health).toContainText(reason);
    await expect(failing.ping).toContainText(t('proxies.unknown'));
    // Why nobody has it is a line of the cell, not a tooltip.
    await expect(
      failing.session.getByText(t('proxies.session.notAssigned'), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      failing.session.getByText(t('proxies.session.failedReason'), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(badge(proxies.row('10.0.0.1:8080'), 'ok')).toBeVisible();
    await proxies.expectSummary({ proxies: 3, free: 2, failed: 1 });

    // Two sessions take the two proxies that work; a third finds none left.
    await api.createSession('alpha');
    await api.createSession('beta');
    await eventually(proxies.row('10.0.0.1:8080').session).toContainText(
      'alpha',
    );
    await eventually(proxies.row('10.0.0.3:8080').session).toContainText(
      'beta',
    );
    await expect(failing.session).toContainText(
      t('proxies.session.notAssigned'),
    );
    await expect(failing.session).not.toContainText('alpha');
    await expect(api.createSession('gamma')).rejects.toThrow('no_free_proxy');
    await proxies.expectSummary({ proxies: 3, free: 0, failed: 1 });
  });

  test('Check looks at one proxy again and leaves the others as they were', async ({
    page,
    api,
    control,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080');
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    await control.exitIps({
      '10.0.0.1:8080': { ip: '198.51.100.1', country: 'FR' },
      '10.0.0.2:8080': { ip: '198.51.100.2', country: 'GB' },
    });
    const proxies = await ProxiesPage.open(page);
    const first = proxies.row('10.0.0.1:8080');
    const second = proxies.row('10.0.0.2:8080');
    await expect(first.exit).toContainText('203.0.113.1');

    await proxies.checkRow('10.0.0.1:8080');
    await soon(proxies.toast(t('proxies.toasts.checking'))).toBeVisible();
    await soon(badge(first, 'checking')).toBeVisible();
    // The last answer stays until the new one is in, and the menu cannot start
    // a second check meanwhile.
    await expect(first.exit).toContainText('203.0.113.1');
    await first.menu.click();
    await expect(
      page.getByRole('menuitem', { name: t('proxies.row.check') }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(badge(second, 'ok')).toBeVisible();

    await eventually(badge(first, 'ok')).toBeVisible();
    await expect(first.exit).toContainText('198.51.100.1');
    await expect(first.exit).toContainText(countryText('FR'));
    // The other proxy was not asked, so it still has its old answer.
    await expect(second.exit).toContainText('203.0.113.2');
    await expect(second.exit).not.toContainText('198.51.100.2');
  });

  test('Check all looks at every proxy again, and waits while they all are being looked at', async ({
    page,
    api,
    control,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080', '10.0.0.3:8080');
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    await control.exitIps({
      '10.0.0.1:8080': { ip: '198.51.100.1', country: 'FR' },
      '10.0.0.2:8080': { error: 'connection refused' },
      '10.0.0.3:8080': { ip: '198.51.100.3', country: 'US' },
    });
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.checkAll).toBeEnabled();
    await proxies.expectSummary({ proxies: 3, free: 3 });

    await proxies.checkAll.click();
    await soon(proxies.toast(t('proxies.toasts.checkingAll'))).toBeVisible();
    for (const hostPort of [
      '10.0.0.1:8080',
      '10.0.0.2:8080',
      '10.0.0.3:8080',
    ]) {
      await soon(badge(proxies.row(hostPort), 'checking')).toBeVisible();
    }
    // Nothing left to ask for: the button says why it waits.
    await expect(proxies.checkAll).toBeDisabled();
    // The click left the focus on the button: leave and come back, as a keyboard user does.
    await proxies.checkAll.blur();
    await proxies.checkAll.focus();
    await soon(page.getByRole('tooltip')).toHaveText(
      t('proxies.checkAll.busy'),
    );

    await eventually(proxies.row('10.0.0.2:8080').health).toContainText(
      t('proxies.health.failed'),
    );
    await expect(proxies.row('10.0.0.2:8080').health).toContainText(
      'connection refused',
    );
    await expect(proxies.row('10.0.0.1:8080').exit).toContainText(
      '198.51.100.1',
    );
    await expect(proxies.row('10.0.0.3:8080').exit).toContainText(
      '198.51.100.3',
    );
    await expect(proxies.row('10.0.0.3:8080').exit).toContainText(
      countryText('US'),
    );
    await proxies.expectSummary({ proxies: 3, free: 2, failed: 1 });
    await expect(proxies.checkAll).toBeEnabled();
  });

  test('says when the proxy was checked, under its badge, and keeps the time of the last check while a new one runs', async ({
    page,
    api,
    control,
  }) => {
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    const proxies = await ProxiesPage.open(page);
    await proxies.add('10.0.0.7:8080');
    const row = proxies.row('10.0.0.7:8080');
    const time = row.health.getByRole('time');

    // Not checked yet, so there is no time to tell.
    await soon(badge(row, 'checking')).toBeVisible();
    await expect(time).toHaveCount(0);

    // Once it is, the time is that of the check, and its exact date is in the tooltip.
    await eventually(badge(row, 'ok')).toBeVisible();
    const [stored] = await api.proxies();
    const checkedAt = stored.check.checkedAt ?? '';
    await expect(time).toHaveAttribute('datetime', checkedAt);
    await expect(time).toContainText(
      t('proxies.health.checked').replace('{when}', '').trim(),
    );
    await expect(time).toHaveAttribute('title', /\S/);

    // A new check runs: the badge says so, the time is still the last check's.
    await proxies.checkRow('10.0.0.7:8080');
    await soon(badge(row, 'checking')).toBeVisible();
    await expect(time).toHaveAttribute('datetime', checkedAt);
    await eventually(badge(row, 'ok')).toBeVisible();
  });

  test('is "Working" again once a check of a failed proxy succeeds', async ({
    page,
    api,
    control,
  }) => {
    await control.exitIps({
      '10.0.0.1:8080': { error: 'connection timed out' },
    });
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    const row = proxies.row('10.0.0.1:8080');
    await soon(row.health).toContainText('connection timed out');
    await proxies.expectSummary({ proxies: 1, free: 0, failed: 1 });

    await control.exitIps({
      '10.0.0.1:8080': { ip: '198.51.100.9', country: 'US' },
    });
    await proxies.checkRow('10.0.0.1:8080');
    await eventually(badge(row, 'ok')).toBeVisible();
    await expect(row.health).not.toContainText('connection timed out');
    await expect(row.exit).toContainText('198.51.100.9');
    await expect(row.ping).toHaveText(pingText(42));
    await proxies.expectSummary({ proxies: 1, free: 1 });
  });
});

// ---------------------------------------------------------------------------
// The session a proxy belongs to
// ---------------------------------------------------------------------------

test.describe('the session of a proxy', () => {
  test('is named in the row with its status, and its link opens the session', async ({
    page,
    api,
  }) => {
    const { session } = await sessionHolding(api, 'alpha', '10.0.0.1:8080');
    await importChecked(api, '10.0.0.2:8080');
    const proxies = await ProxiesPage.open(page);

    const held = proxies.row('10.0.0.1:8080');
    await soon(held.session).toContainText(t('sessions.status.running'));
    const link = held.session.getByRole('link', { name: 'alpha' });
    await expect(link).toHaveAttribute('href', `/sessions/${session.id}`);
    await expect(proxies.row('10.0.0.2:8080').session).toHaveText(
      t('proxies.session.free'),
    );
    // A proxy a session holds is not free.
    await proxies.expectSummary({ proxies: 2, free: 1 });

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}$`));
  });

  test('shows the status of the session as it changes, without a reload', async ({
    page,
    api,
  }) => {
    const { session } = await sessionHolding(api, 'alpha', '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    const row = proxies.row('10.0.0.1:8080');
    await soon(row.session).toContainText(t('sessions.status.running'));

    await api.stopSession(session.id);
    await eventually(row.session).toContainText(t('sessions.status.stopped'));
    // Stopped, the session still has the proxy.
    await expect(row.session).toContainText('alpha');
    await proxies.expectSummary({ proxies: 1, free: 0 });

    await api.deleteSession(session.id);
    await eventually(row.session).toHaveText(t('proxies.session.free'));
    await proxies.expectSummary({ proxies: 1, free: 1 });
  });

  test('shows a session that is still starting, and then running', async ({
    page,
    api,
    control,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    await control.faults({ launchDelayMs: SLOW_CHECK_MS });
    await api.createSession('alpha');
    const proxies = await ProxiesPage.open(page);
    const row = proxies.row('10.0.0.1:8080');

    await soon(row.session).toContainText('alpha');
    await expect(row.session).toContainText(t('sessions.status.starting'));
    await eventually(row.session).toContainText(t('sessions.status.running'));
  });

  test('shows the error of a session that could not start, which still has its proxy', async ({
    page,
    api,
    control,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    await control.faults({ launchError: 'the browser would not start' });
    const created = await api.createSession('alpha');
    await api.waitForStatus(created.id, 'error');
    const proxies = await ProxiesPage.open(page);
    const row = proxies.row('10.0.0.1:8080');
    await soon(row.session).toContainText('alpha');
    await expect(row.session).toContainText(t('sessions.status.error'));
  });

  test("flags a proxy that exits through the IP of a session's proxy: it is not assigned", async ({
    page,
    api,
  }) => {
    // 10.0.1.5 exits through 203.0.113.5, as 10.0.0.5 does.
    const { session } = await sessionHolding(api, 'alpha', '10.0.0.5:8080');
    await importChecked(api, '10.0.1.5:8081', '10.0.0.9:8080');
    const proxies = await ProxiesPage.open(page);

    const flagged = proxies.row('10.0.1.5:8081');
    await soon(flagged.exit).toContainText('203.0.113.5');
    // A flag with the name of the session, and the reason as a line of the cell.
    await expect(flagged.session).toContainText(
      fill(t('proxies.session.sameIp'), { name: 'alpha' }),
    );
    await expect(
      flagged.session.getByText(
        fill(t('proxies.session.sameIpReason'), { name: 'alpha' }),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(proxies.row('10.0.0.9:8080').session).toHaveText(
      t('proxies.session.free'),
    );
    // Only the third proxy can be given to a session.
    await proxies.expectSummary({ proxies: 3, free: 1 });
    const beta = await api.createSession('beta');
    await eventually(proxies.row('10.0.0.9:8080').session).toContainText(
      'beta',
    );
    await expect(flagged.session).toContainText(
      fill(t('proxies.session.sameIp'), { name: 'alpha' }),
    );
    await expect(api.createSession('gamma')).rejects.toThrow('no_free_proxy');

    // Without the session that has the IP, the flag goes.
    await api.deleteSession(beta.id);
    await api.deleteSession(session.id);
    await eventually(flagged.session).toHaveText(t('proxies.session.free'));
    await proxies.expectSummary({ proxies: 3, free: 3 });
  });
});

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

test.describe('deleting a proxy', () => {
  test('asks first: Cancel, Escape and Close keep it, the confirmation removes it', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080');
    const proxies = await ProxiesPage.open(page);
    const dialog = proxies.deleteDialog('plain');
    await expect(proxies.rows).toHaveCount(2);

    await proxies.deleteRow('10.0.0.2:8080');
    await soon(dialog).toBeVisible();
    await expect(dialog).toContainText(
      fill(t('proxies.delete.description'), { proxy: '10.0.0.2:8080' }),
    );
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();
    await expect(proxies.row('10.0.0.2:8080').row).toBeVisible();

    await proxies.deleteRow('10.0.0.2:8080');
    await soon(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await soon(dialog).toBeHidden();

    await proxies.deleteRow('10.0.0.2:8080');
    await soon(dialog).toBeVisible();
    await dialog.getByRole('button', { name: t('common.aria.close') }).click();
    await soon(dialog).toBeHidden();
    expect(await api.proxies()).toHaveLength(2);

    await proxies.deleteRow('10.0.0.2:8080');
    await soon(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();
    await soon(dialog).toBeHidden();
    await soon(proxies.toast(t('proxies.toasts.deleted'))).toBeVisible();
    await expect(proxies.row('10.0.0.2:8080').row).toHaveCount(0);
    await expect(proxies.rows).toHaveCount(1);
    await proxies.expectSummary({ proxies: 1, free: 1 });
    await expect(proxies.footer).toHaveText(showingAll(1));
    expect((await api.proxies()).map((proxy) => proxy.host)).toEqual([
      '10.0.0.1',
    ]);

    // The pool is the same after a reload.
    await page.reload();
    await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
    await expect(proxies.rows).toHaveCount(1);
  });

  test('removes the last proxy and leaves the empty state', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    await proxies.deleteRow('10.0.0.1:8080');
    await proxies
      .deleteDialog('plain')
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();
    await soon(
      proxies.table.getByRole('heading', { name: t('proxies.empty.title') }),
    ).toBeVisible();
    await expect(proxies.checkAll).toHaveCount(0);
    expect(await api.proxies()).toEqual([]);
  });

  test('of a stopped session warns that the session gets another proxy, and then does', async ({
    page,
    api,
    request,
  }) => {
    const { session } = await sessionHolding(
      api,
      'alpha',
      '10.0.0.1:8080',
      'stopped',
    );
    const proxies = await ProxiesPage.open(page);
    await soon(proxies.row('10.0.0.1:8080').session).toContainText(
      t('sessions.status.stopped'),
    );

    await proxies.deleteRow('10.0.0.1:8080');
    const dialog = proxies.deleteDialog('in-use');
    await soon(dialog).toBeVisible();
    await expect(dialog).toContainText(
      fill(t('proxies.delete.inUseDescription'), {
        name: 'alpha',
        proxy: '10.0.0.1:8080',
      }),
    );
    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();
    expect(await api.proxies()).toHaveLength(1);

    await proxies.deleteRow('10.0.0.1:8080');
    await dialog
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();
    await soon(dialog).toBeHidden();
    await expect(proxies.row('10.0.0.1:8080').row).toHaveCount(0);

    // The session stays, without a proxy, and takes a free one when it starts.
    expect((await api.session(session.id)).proxy).toBeNull();
    await importChecked(api, '10.0.0.2:8080');
    const started = await request.post(`/api/sessions/${session.id}/start`, {
      data: {},
    });
    expect(started.ok()).toBe(true);
    const running = await api.waitForStatus(session.id, 'running');
    expect(running.proxy?.display).toBe('http://10.0.0.2:8080');
    await soon(proxies.row('10.0.0.2:8080').session).toContainText('alpha');
  });

  test('of a session that could not start is asked about like that of a stopped one', async ({
    page,
    api,
    control,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    await control.faults({ launchError: 'the browser would not start' });
    const created = await api.createSession('alpha');
    await api.waitForStatus(created.id, 'error');
    const proxies = await ProxiesPage.open(page);

    await proxies.deleteRow('10.0.0.1:8080');
    await expect(proxies.deleteDialog('in-use')).toContainText('alpha');
    await proxies
      .deleteDialog('in-use')
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();
    await expect(proxies.row('10.0.0.1:8080').row).toHaveCount(0);
    expect((await api.session(created.id)).proxy).toBeNull();
  });

  test('of a running session is refused, naming the session, and the pool keeps it', async ({
    page,
    api,
  }) => {
    const { session } = await sessionHolding(api, 'alpha', '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    await soon(proxies.row('10.0.0.1:8080').session).toContainText(
      t('sessions.status.running'),
    );

    await proxies.deleteRow('10.0.0.1:8080');
    const dialog = proxies.deleteDialog('busy');
    await soon(dialog).toBeVisible();
    await expect(dialog).toContainText(
      fill(t('proxies.delete.busyDescription'), {
        name: 'alpha',
        proxy: '10.0.0.1:8080',
      }),
    );
    // Nothing to confirm: the way out is to stop the session.
    await expect(
      dialog.getByRole('button', { name: t('proxies.delete.confirm') }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole('link', { name: t('proxies.delete.openSession') }),
    ).toHaveAttribute('href', `/sessions/${session.id}`);

    await dialog
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    await soon(dialog).toBeHidden();
    expect(await api.proxies()).toHaveLength(1);

    await proxies.deleteRow('10.0.0.1:8080');
    await dialog
      .getByRole('link', { name: t('proxies.delete.openSession') })
      .click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}$`));
    expect(await api.proxies()).toHaveLength(1);
  });

  test('follows a session that starts while the question is open, and can be done once it stops', async ({
    page,
    api,
  }) => {
    const { session } = await sessionHolding(
      api,
      'alpha',
      '10.0.0.1:8080',
      'stopped',
    );
    const proxies = await ProxiesPage.open(page);
    await soon(proxies.row('10.0.0.1:8080').session).toContainText(
      t('sessions.status.stopped'),
    );

    await proxies.deleteRow('10.0.0.1:8080');
    await soon(proxies.deleteDialog('in-use')).toBeVisible();

    // The session starts while the dialog asks: it has to be stopped first.
    await page.request.post(`/api/sessions/${session.id}/start`, { data: {} });
    await eventually(proxies.deleteDialog('busy')).toBeVisible();
    await expect(proxies.deleteDialog('busy')).toContainText('alpha');
    await proxies
      .deleteDialog('busy')
      .getByRole('button', { name: t('common.actions.cancel') })
      .click();
    expect(await api.proxies()).toHaveLength(1);

    await api.waitForStatus(session.id, 'running');
    await api.stopSession(session.id);
    await eventually(proxies.row('10.0.0.1:8080').session).toContainText(
      t('sessions.status.stopped'),
    );
    await proxies.deleteRow('10.0.0.1:8080');
    await proxies
      .deleteDialog('in-use')
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();
    await soon(proxies.toast(t('proxies.toasts.deleted'))).toBeVisible();
    expect(await api.proxies()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The counts
// ---------------------------------------------------------------------------

test.describe('the counts above the table', () => {
  test('say how many proxies there are, how many are free and how many do not work', async ({
    page,
    api,
    control,
  }) => {
    await control.exitIps({ '10.0.0.2:8080': { error: 'connection refused' } });
    // alpha holds the first; the second does not work; the third exits through
    // the IP of the first (203.0.113.1), so it is not given out either.
    await sessionHolding(api, 'alpha', '10.0.0.1:8080');
    await importChecked(api, '10.0.0.2:8080', '10.0.1.1:8081', '10.0.0.9:8080');
    const proxies = await ProxiesPage.open(page);

    await proxies.expectSummary({ proxies: 4, free: 1, failed: 1 });

    // They follow what is added and what is taken away.
    await proxies.add('10.0.0.10:8080');
    await soon(proxies.addDialog).toBeHidden();
    await proxies.expectSummary({ proxies: 5, free: 2, failed: 1 });

    await proxies.deleteRow('10.0.0.2:8080');
    await proxies
      .deleteDialog('plain')
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();
    await proxies.expectSummary({ proxies: 4, free: 2 });
    await expect(proxies.rows).toHaveCount(4);
    await expect(proxies.footer).toHaveText(showingAll(4));
  });

  test('read "1 proxy · 1 free" for a pool of one', async ({ page, api }) => {
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    await proxies.expectSummary({ proxies: 1, free: 1 });
    await expect(proxies.footer).toHaveText(showingAll(1));
  });
});

// ---------------------------------------------------------------------------
// The table and its toolbar
// ---------------------------------------------------------------------------

test.describe('the table and its toolbar', () => {
  test('hold Check all proxies before the Add menu, and nothing of either in the header', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(1);

    // The first two buttons of the table's region are the toolbar's, in this order.
    const buttons = proxies.region.getByRole('button');
    await expect(buttons.nth(0)).toHaveAccessibleName(
      t('proxies.actions.checkAll'),
    );
    await expect(buttons.nth(1)).toHaveAccessibleName(t('proxies.actions.add'));
    // They are the only ones on the page: the header holds the title and no action.
    await expect(
      page.getByRole('button', { name: t('proxies.actions.checkAll') }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: t('proxies.actions.add'), exact: true }),
    ).toHaveCount(1);
    await expect(proxies.heading).toBeVisible();
  });

  test('say everything in their cells: no tooltip keeps a fact that the cell lacks', async ({
    page,
    api,
    control,
  }) => {
    await control.exitIps({
      '10.0.0.2:8080': { error: 'the proxy rejected the credentials' },
    });
    await sessionHolding(api, 'alpha', '10.0.0.1:8080');
    await importChecked(api, '10.0.0.2:8080');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(2);
    await soon(proxies.row('10.0.0.2:8080').health).toContainText(
      t('proxies.health.failed'),
    );

    const titled = await proxies.table
      .locator('[title]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          tag: element.tagName,
          title: element.getAttribute('title'),
          text: element.textContent?.trim(),
        })),
      );
    // The exact date of a check is what a tooltip is for (the cell says how long
    // ago); the badges repeat their own word; there is no other.
    expect(titled.map(({ tag }) => tag)).toContain('TIME');
    for (const { tag, title, text } of titled) {
      if (tag !== 'TIME') expect(title).toBe(text);
    }
  });

  test('keep their columns in a laptop window of 1024 pixels', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    await page.setViewportSize({ width: 1024, height: 768 });
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.table.getByRole('columnheader')).toHaveCount(6);
    await expect(
      proxies.row('10.0.0.1:8080').row.getByRole('cell'),
    ).toHaveCount(6);
  });
});

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

test.describe('searching the pool', () => {
  async function seedPool(
    api: Parameters<typeof importChecked>[0],
    control: {
      exitIps: (
        answers: Record<string, { ip: string; country: string }>,
      ) => Promise<void>;
    },
  ) {
    await control.exitIps({
      '10.0.0.2:9090': { ip: '198.51.100.2', country: 'JP' },
    });
    // alpha holds the first, which exits through 203.0.113.1; so does the fourth.
    await sessionHolding(api, 'alpha', '10.0.0.1:8080');
    await importChecked(
      api,
      '10.0.0.2:9090',
      '10.0.0.3:8080',
      '10.0.1.1:7070',
      'socks5://10.0.0.4:1080',
    );
  }

  const A = '10.0.0.1:8080';
  const B = '10.0.0.2:9090';
  const C = '10.0.0.3:8080';
  const D = '10.0.1.1:7070';
  const E = '10.0.0.4:1080';

  async function expectFound(
    proxies: ProxiesPage,
    query: string,
    expected: string[],
  ): Promise<void> {
    await proxies.searchFor(query);
    await expect
      .poll(async () => (await proxies.drawnHostPorts()).sort(), {
        timeout: TIMEOUT.VISIBLE,
        message: `the proxies that "${query}" finds`,
      })
      .toEqual([...expected].sort());
  }

  test('finds a proxy by its host, port, type, exit IP, country or session', async ({
    page,
    api,
    control,
  }) => {
    await seedPool(api, control);
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(5);

    await expectFound(proxies, '10.0.0.2', [B]);
    await expectFound(proxies, '9090', [B]);
    await expectFound(proxies, 'socks5', [E]);
    await expectFound(proxies, '198.51.100.2', [B]);
    await expectFound(proxies, '203.0.113.1', [A, D]);
    await expectFound(proxies, 'JP', [B]);
    // Countries are found by their name in the language of the page, in any case.
    await expectFound(proxies, 'japan', [B]);
    await expectFound(proxies, 'GERMANY', [A, C, D, E]);
    // A session is found by its name, with the proxy it holds and the one
    // that is flagged for having its IP.
    await expectFound(proxies, 'alpha', [A, D]);
    await expect(proxies.footer).toHaveText(showingSome(2, 5));

    // The counts above the table are the pool's, whatever is searched.
    await proxies.expectSummary({ proxies: 5, free: 3 });
  });

  test('finds a proxy by the words its cells say: its health and why, whether a session can have it, the state of its session', async ({
    page,
    api,
    control,
  }) => {
    const reason = 'the proxy rejected the credentials';
    await control.exitIps({ '10.0.0.9:9999': { error: reason } });
    await seedPool(api, control);
    await importChecked(api, '10.0.0.9:9999');
    const F = '10.0.0.9:9999';
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(6);
    await expect(proxies.row(F).health).toContainText(
      t('proxies.health.failed'),
    );

    // What a person reads in the table is what they can type.
    await expectFound(proxies, t('proxies.health.failed'), [F]);
    await expectFound(proxies, reason, [F]);
    await expectFound(proxies, t('proxies.session.free'), [B, C, E]);
    // Nobody has a proxy that does not work, or one that shares the IP of a session's.
    await expectFound(proxies, t('proxies.session.notAssigned'), [D, F]);
    await expectFound(proxies, t('sessions.status.running'), [A]);
    // The flag of a shared exit IP is found by its words, with the session's name.
    await expectFound(
      proxies,
      fill(t('proxies.session.sameIp'), { name: 'alpha' }),
      [D],
    );
  });

  test('says so when nothing matches, and "Clear search" brings the pool back', async ({
    page,
    api,
    control,
  }) => {
    await seedPool(api, control);
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(5);

    await proxies.searchFor('no such proxy');
    await soon(
      proxies.table.getByRole('heading', {
        name: t('common.search.noResults'),
      }),
    ).toBeVisible();
    await expect(proxies.table).toContainText(t('common.search.tryAdjusting'));
    await expect(proxies.rows).toHaveCount(0);
    await proxies.expectSummary({ proxies: 5, free: 3 });

    await proxies.clearSearch.click();
    await expect(proxies.search).toHaveValue('');
    await expect(proxies.rows).toHaveCount(5);
    await expect(proxies.footer).toHaveText(showingAll(5));
  });

  test('keeps a proxy findable after it was changed: the search looks at what the rows show now', async ({
    page,
    api,
    control,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080');
    const proxies = await ProxiesPage.open(page);
    await expectFound(proxies, 'Germany', ['10.0.0.1:8080', '10.0.0.2:8080']);

    // The next check finds the first proxy in France: it moves between searches.
    await control.exitIps({
      '10.0.0.1:8080': { ip: '198.51.100.1', country: 'FR' },
    });
    await proxies.checkRow('10.0.0.1:8080');
    await expect
      .poll(async () => (await proxies.drawnHostPorts()).sort(), {
        timeout: TIMEOUT.BACKGROUND,
        message: 'the proxy that was checked has left the search for Germany',
      })
      .toEqual(['10.0.0.2:8080']);
    await expectFound(proxies, 'France', ['10.0.0.1:8080']);
  });
});

// ---------------------------------------------------------------------------
// A large pool
// ---------------------------------------------------------------------------

test.describe('a pool of 700 proxies', () => {
  const POOL_SIZE = 700;
  // Oldest first, as they are imported; the table lists the newest first.
  const HOST_PORTS = Array.from(
    { length: POOL_SIZE },
    (_, index) =>
      `10.${Math.floor(index / 250)}.${index % 250}.${(index % 200) + 1}:${9000 + index}`,
  );

  test.beforeEach(async ({ api, control }) => {
    // Checks that end at once: the pool is settled when the page opens.
    await control.faults({ checkDelayMs: 0 });
    // One call, as a provider's export is imported.
    const { added } = await api.importProxies(HOST_PORTS.join('\n'));
    expect(added).toHaveLength(POOL_SIZE);
    await expect
      .poll(async () => (await api.meta()).counts.checkingProxies, {
        timeout: TIMEOUT.BACKGROUND,
        message: 'the 700 proxies have been checked',
      })
      .toBe(0);
  });

  // The pool goes with the test that made it.
  test.afterEach(async ({ api }) => {
    await removeAllProxies(api);
  });

  test('loads in windows as the table scrolls, with none lost or repeated', async ({
    page,
  }) => {
    const windows: number[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/proxies') {
        windows.push(Number(url.searchParams.get('limit')));
      }
    });
    const proxies = await ProxiesPage.open(page);

    // Not the whole pool at once: the first rows, and the counts of all of it.
    await soon(proxies.rows.first()).toBeVisible();
    await proxies.expectSummary({ proxies: POOL_SIZE, free: POOL_SIZE });
    await expect(proxies.footer).not.toHaveText(showingAll(POOL_SIZE));
    expect(windows[0]).toBeLessThan(POOL_SIZE);
    expect((await proxies.drawnHostPorts()).length).toBeLessThan(POOL_SIZE / 2);
    expect((await proxies.drawnHostPorts())[0]).toBe(HOST_PORTS.at(-1));

    const { seen, drawnTwice } = await proxies.scrollThrough(
      POOL_SIZE,
      HOST_PORTS.at(-1) ?? '',
    );
    // Newest first, each one once, none left out.
    expect(drawnTwice).toEqual([]);
    expect(seen).toEqual(HOST_PORTS.toReversed());
    await eventually(proxies.footer).toHaveText(showingAll(POOL_SIZE));
    // The server never had to answer more than the API's page.
    expect(Math.max(...windows)).toBeLessThanOrEqual(500);
  });

  test('is searched as a whole: a proxy beyond the first window is found', async ({
    page,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await soon(proxies.rows.first()).toBeVisible();
    const oldest = HOST_PORTS[0];
    const middle = HOST_PORTS[350];
    expect(await proxies.drawnHostPorts()).not.toContain(oldest);

    await proxies.searchFor(oldest);
    await expect(proxies.rows).toHaveCount(1);
    await expect(proxies.row(oldest).row).toBeVisible();
    await expect(proxies.footer).toHaveText(showingSome(1, POOL_SIZE));

    await proxies.searchFor(middle);
    await expect(proxies.rows).toHaveCount(1);
    await expect(proxies.row(middle).row).toBeVisible();

    // A search that matches many is scrolled like the whole pool: the 200
    // proxies of 10.2.x.y, newest first.
    const third = HOST_PORTS.slice(500);
    await proxies.searchFor('10.2.');
    const { seen, drawnTwice } = await proxies.scrollThrough(
      third.length,
      third.at(-1) ?? '',
    );
    expect(drawnTwice).toEqual([]);
    expect(seen).toEqual(third.toReversed());

    await proxies.clearSearch.click();
    await expect(proxies.search).toHaveValue('');
    await expect
      .poll(async () => (await proxies.drawnHostPorts())[0], {
        timeout: TIMEOUT.VISIBLE,
        message: 'the newest proxy is the first row again',
      })
      .toBe(HOST_PORTS.at(-1));
  });

  test('refuses a duplicate of a proxy it has not loaded with the general wording', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await soon(proxies.rows.first()).toBeVisible();
    await proxies.add(HOST_PORTS[0]);

    // The row cannot be pointed at: it is not on the table.
    await soon(proxies.addDialog.getByRole('alert')).toHaveText(
      t('errors.duplicate'),
    );
    await expect(
      proxies.addDialog.getByRole('button', { name: t('proxies.add.show') }),
    ).toHaveCount(0);
    expect((await api.meta()).counts.proxies).toBe(POOL_SIZE);
  });
});

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

test.describe('from the keyboard', () => {
  test('a row menu opens, moves, chooses and gives the focus back, from Enter to Escape', async ({
    page,
    api,
    control,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080');
    await control.faults({ checkDelayMs: SLOW_CHECK_MS });
    const proxies = await ProxiesPage.open(page);
    const { menu } = proxies.row('10.0.0.1:8080');
    const check = page.getByRole('menuitem', { name: t('proxies.row.check') });
    const remove = page.getByRole('menuitem', {
      name: t('common.actions.delete'),
    });

    // Enter opens it; the arrows move; Escape closes it.
    await menu.focus();
    await openMenuWithKeyboard(page, check);
    await page.keyboard.press('ArrowDown');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(remove).toBeHidden();
    await expect(menu).toBeFocused();

    // Enter on Check starts a check.
    await openMenuWithKeyboard(page, check);
    await page.keyboard.press('Enter');
    await soon(badge(proxies.row('10.0.0.1:8080'), 'checking')).toBeVisible();
    await eventually(badge(proxies.row('10.0.0.1:8080'), 'ok')).toBeVisible();
    await expect(menu).toBeFocused();

    // Enter on Delete asks; Escape leaves and the focus is back on the menu button.
    await openMenuWithKeyboard(page, check);
    await page.keyboard.press('ArrowDown');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = proxies.deleteDialog('plain');
    await proxies.expectOpen(dialog);
    await page.keyboard.press('Escape');
    await soon(dialog).toBeHidden();
    await expect(menu).toBeFocused();
    expect(await api.proxies()).toHaveLength(2);

    // Enter on the confirmation deletes.
    await openMenuWithKeyboard(page, check);
    await page.keyboard.press('ArrowDown');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    await soon(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', {
      name: t('proxies.delete.confirm'),
    });
    await confirm.focus();
    await page.keyboard.press('Enter');
    await soon(dialog).toBeHidden();
    await expect(proxies.row('10.0.0.1:8080').row).toHaveCount(0);
    expect(await api.proxies()).toHaveLength(1);
  });

  test('the Add menu and its dialog are used with the keyboard alone', async ({
    page,
    api,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const addProxy = page.getByRole('menuitem', {
      name: t('proxies.actions.addProxy'),
    });
    const importProxies = page.getByRole('menuitem', {
      name: t('proxies.actions.importProxies'),
    });
    await proxies.addMenu.focus();
    await openMenuWithKeyboard(page, addProxy);
    await page.keyboard.press('Enter');

    // The dialog opens on the field; Enter submits what is typed.
    await proxies.expectOpen(proxies.addDialog);
    await expect(proxies.addField).toBeFocused();
    await page.keyboard.type('10.0.0.1:99999');
    await page.keyboard.press('Enter');
    await soon(proxies.addDialog.getByRole('alert')).toHaveText(
      refusalText('invalid_port_value', { port: '99999' }),
    );
    await expect(proxies.addField).toBeFocused();

    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('10.0.0.1:8080');
    await page.keyboard.press('Enter');
    await soon(proxies.addDialog).toBeHidden();
    await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
    await expect(proxies.addMenu).toBeFocused();
    expect(await api.proxies()).toHaveLength(1);

    // The Import dialog the same way: the arrow reaches its item.
    await openMenuWithKeyboard(page, addProxy);
    await page.keyboard.press('ArrowDown');
    await expect(importProxies).toBeFocused();
    await page.keyboard.press('Enter');
    await proxies.expectOpen(proxies.importDialog);
    await expect(proxies.importField).toBeFocused();
    await page.keyboard.press('Escape');
    await soon(proxies.importDialog).toBeHidden();
    await expect(proxies.addMenu).toBeFocused();
  });

  test('after a deletion the focus stays on the table: on the next row, or on Add when none is left', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080', '10.0.0.3:8080');
    const proxies = await ProxiesPage.open(page);
    const check = page.getByRole('menuitem', { name: t('proxies.row.check') });
    const remove = page.getByRole('menuitem', {
      name: t('common.actions.delete'),
    });
    const deleteWithKeyboard = async (hostPort: string) => {
      await proxies.row(hostPort).menu.focus();
      await openMenuWithKeyboard(page, check);
      await page.keyboard.press('ArrowDown');
      await expect(remove).toBeFocused();
      await page.keyboard.press('Enter');
      const dialog = proxies.deleteDialog('plain');
      await proxies.expectOpen(dialog);
      await dialog
        .getByRole('button', { name: t('proxies.delete.confirm') })
        .focus();
      await page.keyboard.press('Enter');
      await soon(dialog).toBeHidden();
      await expect(proxies.row(hostPort).row).toHaveCount(0);
    };

    // The newest comes first: 3, 2, 1. The row that is deleted takes its menu
    // button with it; the focus goes to the next row, not to the page.
    await deleteWithKeyboard('10.0.0.2:8080');
    await expect(proxies.row('10.0.0.1:8080').menu).toBeFocused();
    await deleteWithKeyboard('10.0.0.3:8080');
    await expect(proxies.row('10.0.0.1:8080').menu).toBeFocused();
    await deleteWithKeyboard('10.0.0.1:8080');
    await expect(proxies.addMenu).toBeFocused();
  });

  test('the Type of a proxy is chosen with the arrow keys', async ({
    page,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const dialog = await proxies.openAddDialog();
    await proxies.schemeChoice(dialog, 'http').focus();
    await page.keyboard.press('ArrowRight');
    await expect(proxies.schemeChoice(dialog, 'https')).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect(proxies.schemeChoice(dialog, 'socks5')).toBeChecked();
    await proxies.addField.fill('10.0.0.1:1080');
    await proxies.addSubmit.click();
    await soon(proxies.row('10.0.0.1:1080').address).toHaveText(
      addressText('socks5://', '10.0.0.1:1080'),
    );
  });
});

// ---------------------------------------------------------------------------
// Passwords stay in the backend
// ---------------------------------------------------------------------------

test.describe('proxy passwords', () => {
  test('are nowhere in the page, in what a screen reader reads or in what the API lists', async ({
    page,
    api,
  }) => {
    const withPassword = FORMATS.filter(
      (sample) => sample.password !== undefined,
    );
    const passwords = [
      ...new Set(withPassword.map((sample) => sample.password ?? '')),
    ];
    const { added } = await api.importProxies(
      withPassword.map((sample) => sample.input).join('\n'),
    );
    expect(added).toHaveLength(withPassword.length);
    await untilChecked(api);

    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(withPassword.length);
    const named = Object.fromEntries(
      [...passwords, 'p%40ss%3Aword'].map((password, index) => [
        `password ${index + 1}`,
        password,
      ]),
    );
    expect(await leaksOf(page, named)).toEqual([]);

    // What the API says of a proxy with a password: that it has one.
    const pool = await api.proxies();
    for (const proxy of pool) {
      expect(proxy.hasPassword).toBe(true);
      expect(Object.keys(proxy)).not.toContain('password');
    }
    const listed = JSON.stringify(pool);
    for (const password of [...passwords, 'p%40ss%3Aword']) {
      expect(listed).not.toContain(password);
    }

    // The question before a deletion, and the report of an import, do not say it either.
    await proxies.deleteRow('10.0.0.2:8081');
    await soon(proxies.deleteDialog('plain')).toBeVisible();
    expect(await leaksOf(page, named)).toEqual([]);
    await page.keyboard.press('Escape');
    await proxies.importList(
      withPassword.map((sample) => sample.input).join('\n') +
        `\n10.9.9.9:99999:mallory:${PASSWORD}`,
    );
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 0, duplicates: withPassword.length, errors: 1 }),
    );
    expect(await leaksOf(page, named)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// When the backend fails
// ---------------------------------------------------------------------------

test.describe('when a request fails', () => {
  test('adding is told in a notice, and the dialog stays for another try', async ({
    page,
    api,
  }) => {
    const fault = await failRequests(
      page,
      (url, method) => method === 'POST' && url.pathname === '/api/proxies',
    );
    const proxies = await ProxiesPage.open(page);
    await proxies.add('10.0.0.1:8080');

    await soon(proxies.toast(t('proxies.toasts.addFailed'))).toBeVisible();
    await expect(proxies.toast(t('errors.fallback'))).toBeVisible();
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);
    // Not a refusal of the line: nothing is said beside the field.
    await expect(proxies.addDialog).toBeVisible();
    await expect(proxies.addField).toHaveValue('10.0.0.1:8080');
    await expect(proxies.addField).not.toHaveAttribute('aria-invalid', 'true');
    await expect(proxies.addSubmit).toBeEnabled();
    expect(await api.proxies()).toEqual([]);

    fault.heal();
    await proxies.addSubmit.click();
    await soon(proxies.addDialog).toBeHidden();
    await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
  });

  test('importing is told in a notice, and the list stays for another try', async ({
    page,
    api,
  }) => {
    const fault = await failRequests(
      page,
      (url, method) =>
        method === 'POST' && url.pathname === '/api/proxies/import',
    );
    const proxies = await ProxiesPage.open(page);
    const list = '10.0.0.1:8080\n10.0.0.2:8080';
    await proxies.importList(list);

    await soon(proxies.toast(t('proxies.toasts.importFailed'))).toBeVisible();
    await expect(proxies.toast(t('errors.fallback'))).toBeVisible();
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);
    await expect(proxies.importField).toHaveValue(list);
    await expect(proxies.importSubmit).toBeEnabled();
    expect(await api.proxies()).toEqual([]);

    fault.heal();
    await proxies.importSubmit.click();
    await soon(proxies.importDialog).toBeHidden();
    await soon(proxies.toast(importedText(2))).toBeVisible();
    expect(await api.proxies()).toHaveLength(2);
  });

  test('deleting is told in a notice, and the question stays', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const fault = await failRequests(
      page,
      (url, method) =>
        method === 'DELETE' && url.pathname.startsWith('/api/proxies/'),
    );
    const proxies = await ProxiesPage.open(page);
    await proxies.deleteRow('10.0.0.1:8080');
    const dialog = proxies.deleteDialog('plain');
    const confirm = dialog.getByRole('button', {
      name: t('proxies.delete.confirm'),
    });
    await confirm.click();

    await soon(proxies.toast(t('proxies.toasts.deleteFailed'))).toBeVisible();
    await expect(proxies.toast(t('errors.fallback'))).toBeVisible();
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(confirm).toBeEnabled();
    expect(await api.proxies()).toHaveLength(1);

    fault.heal();
    await confirm.click();
    await soon(dialog).toBeHidden();
    await expect(proxies.row('10.0.0.1:8080').row).toHaveCount(0);
    expect(await api.proxies()).toEqual([]);
  });

  test('checking is told in a notice, and the proxy stays as it was', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const fault = await failRequests(
      page,
      (url, method) => method === 'POST' && url.pathname.endsWith('/check'),
    );
    const proxies = await ProxiesPage.open(page);
    await proxies.checkRow('10.0.0.1:8080');

    await soon(proxies.toast(t('proxies.toasts.checkFailed'))).toBeVisible();
    await expect(proxies.toast(t('errors.fallback'))).toBeVisible();
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);
    await expect(badge(proxies.row('10.0.0.1:8080'), 'ok')).toBeVisible();
  });
});

test.describe('when the backend cannot be reached', () => {
  /**
   * A pool that could not be read at all is named in place of the table, in the
   * page's own words and with its own way to try again: not the library's
   * generic page, with the link to the support of another site, and not "No
   * proxies yet", which would say that the pool is empty. It does not say that
   * what is listed may be out of date: nothing is.
   */
  async function expectUnread(
    page: Page,
    proxies: ProxiesPage,
  ): Promise<Locator> {
    const failure = proxies.region
      .getByRole('alert')
      .filter({ hasText: t('proxies.listFailed') });
    await soon(failure).toBeVisible();
    await expect(failure).not.toContainText(t('proxies.refreshFailed'));
    await expect(
      page.getByRole('heading', {
        name: t('common.errors.somethingWentWrong'),
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: t('common.errors.contactSupport') }),
    ).toHaveCount(0);
    await expect(
      proxies.region.getByRole('heading', { name: t('proxies.empty.title') }),
    ).toHaveCount(0);
    await expect(proxies.table).toHaveCount(0);
    return failure;
  }

  test('on opening, the page says the pool could not be loaded and "Try again" brings it', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const cut = await cutOff(page);
    const proxies = await ProxiesPage.open(page);
    const failure = await expectUnread(page, proxies);
    // The page's banner says why the server cannot be reached; the sentence does not.
    await expect(failure).not.toContainText(t('errors.network'));

    await cut.heal();
    await failure
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
    await expect(failure).toHaveCount(0);
    // The button that was pressed is gone: the keyboard stays on the page's part.
    await expect(proxies.region).toBeFocused();
  });

  test('on opening, an error of the server is told in the same words', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const fault = await failRequests(
      page,
      (url, method) => method === 'GET' && url.pathname === '/api/proxies',
    );
    const proxies = await ProxiesPage.open(page);
    const failure = await expectUnread(page, proxies);
    // Never the backend's own English sentence.
    await expect(page.getByText(fault.message)).toHaveCount(0);

    fault.heal();
    await failure
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
    await expect(failure).toHaveCount(0);
  });

  test('on opening, a refusal that trying again would not mend is told with its cause', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const fault = await failRequests(
      page,
      (url, method) => method === 'GET' && url.pathname === '/api/proxies',
      { status: 403, error: 'forbidden_host', message: 'Forbidden host' },
    );
    const proxies = await ProxiesPage.open(page);
    const failure = await expectUnread(page, proxies);
    await expect(failure).toContainText(t('errors.forbidden_host'));

    fault.heal();
    await failure
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
  });

  test('while the pool is shown, the rows stay and the page says the connection is lost', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(2);
    const lost = page
      .getByRole('alert')
      .filter({ hasText: t('banners.connection.lost') });
    // Above the rows, what the failure means for the list, with the retry.
    const outOfDate = page
      .getByRole('alert')
      .filter({ hasText: t('proxies.refreshFailed') });

    const cut = await cutOff(page);
    // The page asks again on its own, and tells it when nothing answers.
    await eventually(lost).toBeVisible();
    await eventually(outOfDate).toBeVisible();
    await expect(proxies.rows).toHaveCount(2);
    await expect(badge(proxies.row('10.0.0.1:8080'), 'ok')).toBeVisible();

    await cut.heal();
    await outOfDate
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(outOfDate).toHaveCount(0);
    await eventually(lost).toHaveCount(0);
    await expect(proxies.rows).toHaveCount(2);
  });

  test('while the pool is shown, a refusal that trying again would not mend is told with its cause', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(1);
    const outOfDate = page
      .getByRole('alert')
      .filter({ hasText: t('proxies.refreshFailed') });

    // The page was opened at an address the server does not answer.
    const fault = await failRequests(
      page,
      (url, method) => method === 'GET' && url.pathname === '/api/proxies',
      {
        status: 403,
        error: 'forbidden_host',
        message: 'Forbidden host',
      },
    );
    await eventually(outOfDate).toBeVisible();
    await expect(outOfDate).toContainText(t('errors.forbidden_host'));
    await expect(proxies.rows).toHaveCount(1);

    fault.heal();
    await outOfDate
      .getByRole('button', { name: t('common.actions.tryAgain') })
      .click();
    await soon(outOfDate).toHaveCount(0);
    await expect(proxies.rows).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// The backend has the last word
// ---------------------------------------------------------------------------

test.describe('a table that is out of date', () => {
  test('is corrected by the backend when a session took the proxy meanwhile: the question is asked again, as for a stopped session', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    // The page keeps the pool as it read it: the proxy is free.
    await freezeLists(page, '/api/proxies');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.row('10.0.0.1:8080').session).toHaveText(
      t('proxies.session.free'),
    );
    // A session takes it and stops: the page is not told.
    const created = await api.createSession('alpha');
    await api.waitForStatus(created.id, 'running');
    await api.stopSession(created.id);

    await proxies.deleteRow('10.0.0.1:8080');
    const plain = proxies.deleteDialog('plain');
    await proxies.expectOpen(plain);
    await plain
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();

    // The backend refuses; the dialog asks what the backend says, without a notice.
    const asked = proxies.deleteDialog('in-use');
    await soon(asked).toBeVisible();
    await expect(asked).toContainText(
      fill(t('proxies.delete.inUseDescription'), {
        name: 'alpha',
        proxy: '10.0.0.1:8080',
      }),
    );
    await expect(proxies.toast(t('proxies.toasts.deleteFailed'))).toHaveCount(
      0,
    );
    expect(await api.proxies()).toHaveLength(1);

    await asked
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();
    await soon(proxies.toast(t('proxies.toasts.deleted'))).toBeVisible();
    expect(await api.proxies()).toEqual([]);
    expect((await api.session(created.id)).proxy).toBeNull();
  });

  test('is corrected by the backend when a session runs on the proxy meanwhile: it cannot be deleted', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    await freezeLists(page, '/api/proxies');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.row('10.0.0.1:8080').session).toHaveText(
      t('proxies.session.free'),
    );
    const created = await api.createSession('alpha');
    await api.waitForStatus(created.id, 'running');

    await proxies.deleteRow('10.0.0.1:8080');
    const plain = proxies.deleteDialog('plain');
    await proxies.expectOpen(plain);
    await plain
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .click();

    const busy = proxies.deleteDialog('busy');
    await soon(busy).toBeVisible();
    await expect(busy).toContainText(
      fill(t('proxies.delete.busyDescription'), {
        name: 'alpha',
        proxy: '10.0.0.1:8080',
      }),
    );
    await expect(
      busy.getByRole('link', { name: t('proxies.delete.openSession') }),
    ).toHaveAttribute('href', `/sessions/${created.id}`);
    await expect(proxies.toast(t('proxies.toasts.deleteFailed'))).toHaveCount(
      0,
    );
    expect(await api.proxies()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

test.describe('accessibility', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the pool, in every state a row has, and its dialogs pass the audit in ${scheme} mode`, async ({
      page,
      api,
      control,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      // A session that runs, one that is stopped, a proxy that does not work,
      // one that has the IP of the first, and a free one.
      await control.exitIps({
        '10.0.0.3:8080': { error: 'connection refused' },
      });
      await sessionHolding(api, 'alpha', '10.0.0.1:8080');
      await sessionHolding(api, 'beta', '10.0.0.2:8080', 'stopped');
      await importChecked(
        api,
        '10.0.0.3:8080',
        '10.0.1.1:8081',
        '10.0.0.9:8080',
      );
      const proxies = await ProxiesPage.open(page);
      await expect(proxies.rows).toHaveCount(5);

      // A row that is being checked, the one health the others do not show.
      await control.faults({ checkDelayMs: SLOW_CHECK_MS });
      await proxies.checkRow('10.0.0.9:8080');
      await soon(badge(proxies.row('10.0.0.9:8080'), 'checking')).toBeVisible();
      await proxies.dismissNotice(t('proxies.toasts.checking'));
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);

      // The Add dialog refusing, and naming a duplicate.
      await proxies.add('10.0.0.1');
      await soon(proxies.addDialog.getByRole('alert')).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);
      await proxies.addField.fill('socks5://10.0.0.2:8080');
      await proxies.addSubmit.click();
      await soon(
        proxies.addDialog.getByRole('button', { name: t('proxies.add.show') }),
      ).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await soon(proxies.addDialog).toBeHidden();

      // The Import dialog, with a list typed in, then with its report open.
      await proxies.openImportDialog();
      await proxies.importField.fill(
        '10.0.0.5:8080\n10.0.0.5:8080\n10.0.0.4\nsocks4://10.0.0.6:1080',
      );
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);
      await proxies.importSubmit.click();
      await soon(proxies.importDialog.getByRole('status')).toBeVisible();
      await proxies.importDialog
        .getByText(format(t('proxies.result.duplicates'), { count: 1 }), {
          exact: true,
        })
        .click();
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);
      await proxies.importDialog
        .getByRole('button', { name: t('proxies.result.done') })
        .click();
      await soon(proxies.importDialog).toBeHidden();

      // The three questions before a deletion.
      await proxies.deleteRow('10.0.0.5:8080');
      await soon(proxies.deleteDialog('plain')).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await soon(proxies.deleteDialog('plain')).toBeHidden();
      await proxies.deleteRow('10.0.0.2:8080');
      await soon(proxies.deleteDialog('in-use')).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await soon(proxies.deleteDialog('in-use')).toBeHidden();
      await proxies.deleteRow('10.0.0.1:8080');
      await soon(proxies.deleteDialog('busy')).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await soon(proxies.deleteDialog('busy')).toBeHidden();

      // A search that finds nothing.
      await proxies.searchFor('no such proxy');
      await soon(
        proxies.table.getByRole('heading', {
          name: t('common.search.noResults'),
        }),
      ).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page)).toEqual([]);
    });
  }

  test('a pool that could not be read passes the audit in both modes', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    await cutOff(page);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const proxies = await ProxiesPage.open(page);
      await soon(
        proxies.region
          .getByRole('alert')
          .filter({ hasText: t('proxies.listFailed') }),
      ).toBeVisible();
      await untilStill(page);
      expect(await violationsOf(page), scheme).toEqual([]);
    }
  });

  test('the empty pool passes the audit in both modes', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const proxies = await ProxiesPage.open(page);
      await soon(
        proxies.table.getByRole('heading', { name: t('proxies.empty.title') }),
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
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    const navigation = page.getByRole('navigation', {
      name: t('navigation.aria.main'),
    });
    const here = navigation.getByRole('link', {
      name: t('navigation.sections.proxies'),
    });
    const secrets = navigation.getByRole('link', {
      name: t('navigation.sections.secrets'),
    });
    await expect(here).toHaveAttribute('aria-current', 'page');
    await expect(secrets).not.toHaveAttribute('aria-current', 'page');

    await secrets.click();
    await expect(page).toHaveURL(/\/secrets$/);
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.secrets')));
    await page.goBack();
    await expect(page).toHaveURL(/\/proxies$/);
    await expect(page).toHaveTitle(tabTitle(t('navigation.sections.proxies')));
    await soon(proxies.row('10.0.0.1:8080').row).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/secrets$/);
  });

  test('shows a user name as text, whatever it looks like', async ({
    page,
    api,
  }) => {
    const markup = '<img src=x onerror=__pwned=1>';
    // Percent-encoded, as a user name with spaces and brackets has to be written.
    await importChecked(
      api,
      `http://${encodeURIComponent(markup)}:${PASSWORD}@10.0.0.1:8080`,
    );
    const proxies = await ProxiesPage.open(page);
    const row = proxies.row('10.0.0.1:8080');
    await soon(row.address).toHaveText(
      addressText(`http://${markup}@`, '10.0.0.1:8080'),
    );
    await expect(row.address.locator('img')).toHaveCount(0);

    // The question before a deletion and the search see it as text too.
    await proxies.searchFor('onerror');
    await expect(proxies.rows).toHaveCount(1);
    expect(
      await page.evaluate(() => Reflect.get(window, '__pwned')),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The address of the page
// ---------------------------------------------------------------------------

test.describe('the search', () => {
  test('is kept in the address, so that a reload, a link and the way back keep the view', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8081', '10.0.0.3:8082');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(3);
    await expect(page).toHaveURL(/\/proxies$/);

    // Typed, it is written to the address once the typing pauses.
    await proxies.searchFor('10.0.0.2');
    await expect(page).toHaveURL(/\/proxies\?q=10\.0\.0\.2$/);
    await expect(proxies.rows).toHaveCount(1);

    // A reload keeps the view.
    await page.reload();
    await expect(proxies.search).toHaveValue('10.0.0.2');
    await expect(proxies.rows).toHaveCount(1);
    await expect(proxies.row('10.0.0.2:8081').row).toBeVisible();

    // So does a link written by hand, and the way back from another page.
    await page.goto('/proxies?q=10.0.0.3');
    await expect(proxies.search).toHaveValue('10.0.0.3');
    await expect(proxies.row('10.0.0.3:8082').row).toBeVisible();
    await expect(proxies.rows).toHaveCount(1);
    await page
      .getByRole('navigation', { name: t('navigation.aria.main') })
      .getByRole('link', { name: t('navigation.sections.secrets') })
      .click();
    await expect(page).toHaveURL(/\/secrets$/);
    await page.goBack();
    await expect(proxies.search).toHaveValue('10.0.0.3');
    await expect(proxies.rows).toHaveCount(1);

    // Clearing it takes it out of the address.
    await proxies.clearSearch.click();
    await expect(page).toHaveURL(/\/proxies$/);
    await expect(proxies.search).toHaveValue('');
    await expect(proxies.rows).toHaveCount(3);
  });

  test('keeps a number as the text it was typed as', async ({ page, api }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8081');
    const proxies = await ProxiesPage.open(page);
    await proxies.searchFor('8081');
    await expect(page).toHaveURL(/\/proxies\?q=/);
    await expect(proxies.rows).toHaveCount(1);

    await page.reload();
    await expect(proxies.search).toHaveValue('8081');
    await expect(proxies.row('10.0.0.2:8081').row).toBeVisible();
    await expect(proxies.rows).toHaveCount(1);
  });

  test('is only what a search is: a long or odd address still opens the page', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    // Cut to 200 characters, as a search is a few words.
    await page.goto(`/proxies?q=${'x'.repeat(500)}`);
    await expect(proxies.heading).toBeVisible();
    await expect(proxies.search).toHaveValue('x'.repeat(200));
    // A part that is no text is dropped.
    await page.goto('/proxies?q[]=1&q[]=2');
    await expect(proxies.heading).toBeVisible();
    await expect(proxies.search).toHaveValue('');
    await expect(proxies.row('10.0.0.1:8080').row).toBeVisible();
  });

  test('is lifted by Clear search, which is there only while something is typed', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8081');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(2);
    await expect(proxies.clearSearch).toHaveCount(0);

    await proxies.searchFor('8081');
    await expect(proxies.clearSearch).toBeVisible();
    await expect(proxies.rows).toHaveCount(1);

    await proxies.clearSearch.click();
    await expect(proxies.search).toHaveValue('');
    await expect(proxies.rows).toHaveCount(2);
    await expect(proxies.clearSearch).toHaveCount(0);
  });

  test('is put away when a proxy is added, so that the new proxy is the first thing seen', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080', '10.0.0.3:8080');
    const proxies = await ProxiesPage.open(page);
    await proxies.searchFor('10.0.0.2');
    await expect(page).toHaveURL(/\/proxies\?q=10\.0\.0\.2$/);
    await expect(proxies.rows).toHaveCount(1);

    // The new proxy is not what is searched for: it would be out of sight.
    await proxies.addAccepted('10.0.0.9:8080');
    await expect(proxies.search).toHaveValue('');
    await expect(page).toHaveURL(/\/proxies$/);
    await expect(proxies.rows).toHaveCount(4);
    await expect
      .poll(async () => (await proxies.drawnHostPorts())[0], {
        timeout: TIMEOUT.VISIBLE,
        message: 'the newest proxy is the first row',
      })
      .toBe('10.0.0.9:8080');
  });

  test('is put away when a list adds a proxy, and kept when it adds none', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8080');
    const proxies = await ProxiesPage.open(page);
    await proxies.searchFor('10.0.0.1');
    await expect(page).toHaveURL(/\/proxies\?q=10\.0\.0\.1$/);

    // A list of repeated lines adds nothing: the search stays for the report.
    await proxies.importList('10.0.0.1:8080');
    await soon(proxies.importDialog.getByRole('status')).toHaveText(
      importSummary({ added: 0, duplicates: 1, errors: 0 }),
    );
    await proxies.importDialog
      .getByRole('button', { name: t('proxies.result.done') })
      .click();
    await soon(proxies.importDialog).toBeHidden();
    await expect(proxies.search).toHaveValue('10.0.0.1');
    await expect(page).toHaveURL(/\/proxies\?q=10\.0\.0\.1$/);
    await expect(proxies.rows).toHaveCount(1);

    // One that adds a proxy puts it away.
    await proxies.importList('10.0.0.9:8080');
    await soon(proxies.importDialog).toBeHidden();
    await expect(proxies.search).toHaveValue('');
    await expect(page).toHaveURL(/\/proxies$/);
    await expect(proxies.rows).toHaveCount(3);
    await expect(proxies.row('10.0.0.9:8080').row).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// On a phone
// ---------------------------------------------------------------------------

test.describe('on a narrow screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a proxy is one row with everything in it, and nothing to scroll sideways', async ({
    page,
    api,
  }) => {
    await sessionHolding(api, 'alpha', '10.0.0.1:8080');
    const proxies = await ProxiesPage.open(page);
    const { row, menu } = proxies.row('10.0.0.1:8080');
    await soon(row).toBeVisible();

    // The Proxy column, with what the other columns would say under the address,
    // and the menu: two cells, no scrolling table.
    await expect(proxies.table.getByRole('columnheader')).toHaveCount(2);
    await expect(row.getByRole('cell')).toHaveCount(2);
    await expect(menu).toBeInViewport();
    expect(
      await proxies.table.evaluate((table) => {
        for (
          let parent = table.parentElement;
          parent !== null;
          parent = parent.parentElement
        ) {
          if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) {
            return parent.scrollWidth <= parent.clientWidth + 1;
          }
        }
        return true;
      }),
    ).toBe(true);

    // Each fact is named, for a screen reader, which has no column header over it.
    for (const column of [
      t('proxies.columns.exit'),
      t('proxies.columns.health'),
      t('proxies.columns.session'),
    ]) {
      await expect(
        row.getByRole('term').filter({ hasText: column }),
      ).toHaveCount(1);
    }
    await expect(row).toContainText('203.0.113.1');
    await expect(row).toContainText(countryText('DE'));
    await expect(row).toContainText(pingText(42));
    await expect(badge({ row }, 'ok')).toBeVisible();
    await expect(row.getByRole('link', { name: 'alpha' })).toBeVisible();

    // A dialog is as wide as the screen and keeps its buttons in reach.
    const dialog = await proxies.openAddDialog();
    await proxies.expectOpen(dialog);
    await expect(proxies.addSubmit).toBeInViewport();
    await expect(
      dialog.getByRole('button', { name: t('common.actions.cancel') }),
    ).toBeInViewport();
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  });

  test('the table has its columns again when the window grows, and one row per proxy when it shrinks', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080');
    await page.setViewportSize({ width: 1280, height: 800 });
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.table.getByRole('columnheader')).toHaveCount(6);

    await page.setViewportSize({ width: 700, height: 800 });
    await expect(proxies.table.getByRole('columnheader')).toHaveCount(2);
    await expect(
      proxies.row('10.0.0.1:8080').row.getByRole('cell'),
    ).toHaveCount(2);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(proxies.table.getByRole('columnheader')).toHaveCount(6);
  });

  test('a search is lifted by emptying the box: the button that lifts it is for wider screens', async ({
    page,
    api,
  }) => {
    await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8081');
    const proxies = await ProxiesPage.open(page);
    await expect(proxies.rows).toHaveCount(2);

    await proxies.searchFor('8081');
    await expect(proxies.rows).toHaveCount(1);
    await expect(proxies.clearSearch).toBeHidden();

    await proxies.search.fill('');
    await expect(proxies.rows).toHaveCount(2);
  });

  test('the import dialog leaves out the hint about a keyboard shortcut', async ({
    page,
  }) => {
    const proxies = await ProxiesPage.open(page);
    const dialog = await proxies.openImportDialog();
    await proxies.expectOpen(dialog);
    await expect(proxies.importField).toBeVisible();
    await expect(dialog.getByText(SHORTCUT_HINT)).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// With a finger
// ---------------------------------------------------------------------------

test.describe('on a touch screen', () => {
  // As wide as a tablet: it is the finger that takes the hint away, not the width.
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 1024, height: 768 },
  });

  test('a proxy is added, checked and deleted by tapping alone', async ({
    page,
  }) => {
    const proxies = await ProxiesPage.open(page);
    expect(
      await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
    ).toBe(true);

    // The button opens its menu, the menu opens the dialog.
    await proxies.addMenu.tap();
    await page
      .getByRole('menuitem', { name: t('proxies.actions.addProxy') })
      .tap();
    await soon(proxies.addDialog).toBeVisible();
    await proxies.addField.fill('10.0.0.1:8080');
    await proxies.addSubmit.tap();
    await soon(proxies.addDialog).toBeHidden();
    const row = proxies.row('10.0.0.1:8080');
    await eventually(badge(row, 'ok')).toBeVisible();

    // The menu of the row checks it again.
    await row.menu.tap();
    await page.getByRole('menuitem', { name: t('proxies.row.check') }).tap();
    await soon(proxies.toast(t('proxies.toasts.checking'))).toBeVisible();
    await eventually(badge(row, 'ok')).toBeVisible();

    // And deletes it, after the question.
    await row.menu.tap();
    await page
      .getByRole('menuitem', { name: t('common.actions.delete') })
      .tap();
    const question = proxies.deleteDialog('plain');
    await soon(question).toBeVisible();
    await question
      .getByRole('button', { name: t('proxies.delete.confirm') })
      .tap();
    await soon(question).toBeHidden();
    await soon(
      proxies.table.getByRole('heading', { name: t('proxies.empty.title') }),
    ).toBeVisible();
  });

  test('the import dialog does not tell of a keyboard shortcut there are no keys for', async ({
    page,
  }) => {
    const proxies = await ProxiesPage.open(page);
    await proxies.addMenu.tap();
    await page
      .getByRole('menuitem', { name: t('proxies.actions.importProxies') })
      .tap();
    await soon(proxies.importDialog).toBeVisible();
    await expect(proxies.importField).toBeVisible();
    await expect(proxies.importDialog.getByText(SHORTCUT_HINT)).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// In another language
// ---------------------------------------------------------------------------

const LOCALE = { de: 'de-DE', fr: 'fr-FR' } as const;

for (const language of ['de', 'fr'] as const) {
  test.describe(`in ${language}`, () => {
    test.use({ locale: LOCALE[language] });

    test('the page, its toolbar and its table are worded in the language of the browser', async ({
      page,
      api,
    }) => {
      const words = tIn[language];
      await importChecked(api, '10.0.0.1:8080');
      await page.goto('/proxies');
      await expect(
        page.getByRole('heading', { level: 1, name: words('proxies.title') }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await expect(page).toHaveTitle(tabTitle(words('proxies.title')));

      const region = page.getByRole('region', {
        name: words('proxies.table.region'),
      });
      await expect(
        region.getByRole('button', { name: words('proxies.actions.checkAll') }),
      ).toBeVisible();
      await expect(
        region.getByRole('button', {
          name: words('proxies.actions.add'),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        region.getByRole('table', { name: words('proxies.table.caption') }),
      ).toBeVisible();
      await expect(
        region.getByRole('button', {
          name: fill(words('proxies.row.actionsFor'), {
            proxy: '10.0.0.1:8080',
          }),
        }),
      ).toBeVisible();
    });

    test('the button that lifts a search says so, and is not the library\'s "Clear all"', async ({
      page,
      api,
    }) => {
      const words = tIn[language];
      await importChecked(api, '10.0.0.1:8080', '10.0.0.2:8081');
      await page.goto('/proxies');
      const region = page.getByRole('region', {
        name: words('proxies.table.region'),
      });
      const search = region.getByRole('textbox', {
        name: words('proxies.search.placeholder'),
      });
      await search.click();
      await search.fill('8081');

      // The library's own words for it read as deleting every proxy in German.
      await expect(
        region.getByRole('button', { name: words('proxies.search.clear') }),
      ).toBeVisible();
      await expect(
        region.getByRole('button', { name: words('common.actions.clearAll') }),
      ).toHaveCount(0);
    });
  });
}
