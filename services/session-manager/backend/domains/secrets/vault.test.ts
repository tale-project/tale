import { describe, expect, it } from 'vitest';

import {
  SECRET_KINDS,
  secretKindInfoSchema,
} from '../../../lib/api/schemas.ts';
import type { SecretFieldIn, SecretKind } from '../../../lib/api/schemas.ts';
import {
  MAX_FIELDS,
  MAX_LABEL,
  MAX_TITLE,
  MAX_VALUE,
} from '../../../lib/secret-limits.ts';
import {
  KIND_KEYS,
  KINDS,
  SecretError,
  cleanFields,
  cleanTitle,
  isCardNumber,
  preview,
} from './vault.ts';
import type { SecretField } from './vault.ts';

type Row = readonly [label: string, value: string, hidden?: boolean | null];

function rows(kind: SecretKind, input: readonly Row[]): SecretField[] {
  return cleanFields(
    kind,
    input.map(([label, value, hidden]): SecretFieldIn => ({
      label,
      value,
      hidden,
    })),
  );
}

function isHidden(kind: SecretKind, label: string, value = 'x'): boolean {
  return rows(kind, [[label, value]])[0].hidden;
}

/** `partial` plus the Luhn check digit: a number every card checksum accepts. */
function withCheckDigit(partial: string): string {
  let total = 0;
  for (let position = 0; position < partial.length; position++) {
    const digit = Number(partial[partial.length - 1 - position]);
    const doubled = position % 2 === 0 ? digit * 2 : digit;
    total += doubled > 9 ? doubled - 9 : doubled;
  }
  return `${partial}${(10 - (total % 10)) % 10}`;
}

describe('the kinds of secret', () => {
  it('match the API', () => {
    expect(KIND_KEYS).toEqual(SECRET_KINDS);
    expect(KIND_KEYS).toEqual(['personal', 'credentials', 'card', 'note']);
    expect(KINDS.map((kind) => kind.label)).toEqual([
      'Personal information',
      'Credentials',
      'Credit card',
      'Note',
    ]);
  });

  it('are shaped as the API lists them', () => {
    expect(() => secretKindInfoSchema.array().parse(KINDS)).not.toThrow();
  });

  it('start with the fields of the Secrets tab', () => {
    const table = Object.fromEntries(
      KINDS.map((kind) => [
        kind.key,
        kind.fields.map((spec) => [
          spec.label,
          spec.hidden ? 'hidden' : spec.multiline ? 'multiline' : 'plain',
        ]),
      ]),
    );
    expect(table).toEqual({
      personal: [
        ['Name', 'plain'],
        ['Email', 'plain'],
        ['Phone', 'plain'],
        ['Address', 'multiline'],
        ['Company', 'plain'],
        ['Company address', 'multiline'],
      ],
      credentials: [
        ['Website', 'plain'],
        ['Username', 'plain'],
        ['Password', 'hidden'],
      ],
      card: [
        ['Cardholder', 'plain'],
        ['Card number', 'hidden'],
        ['Expiry', 'plain'],
        ['CVC', 'hidden'],
      ],
      note: [['Note', 'multiline']],
    });
  });

  it('list a password as hidden and not multiline', () => {
    const credentials = KINDS.find((kind) => kind.key === 'credentials');
    expect(credentials?.fields.find((f) => f.label === 'Password')).toEqual({
      label: 'Password',
      hidden: true,
      multiline: false,
    });
  });
});

describe('cleanTitle', () => {
  it('trims the title', () => {
    expect(cleanTitle('  Visa  ')).toBe('Visa');
  });

  it.each(['', '   ', 'x'.repeat(MAX_TITLE + 1)])(
    'refuses %j',
    (bad: string) => {
      expect(() => cleanTitle(bad)).toThrow(SecretError);
      expect(() => cleanTitle(bad)).toThrow(
        'The title must be 1-120 characters long.',
      );
    },
  );

  it('accepts the longest title, counting characters rather than UTF-16 code units', () => {
    expect(cleanTitle('x'.repeat(MAX_TITLE))).toHaveLength(MAX_TITLE);
    const emoji = '😀'.repeat(MAX_TITLE);
    expect(cleanTitle(emoji)).toBe(emoji);
    expect(() => cleanTitle('😀'.repeat(MAX_TITLE + 1))).toThrow(SecretError);
  });

  it('measures the trimmed title', () => {
    expect(cleanTitle(` ${'x'.repeat(MAX_TITLE)} `)).toHaveLength(MAX_TITLE);
  });
});

describe('isCardNumber', () => {
  it.each([
    '4242 4242 4242 4242',
    '4111111111111111',
    '5555555555554444',
    '378282246310005',
    '6011111111111117',
    '3530111333300000',
    '4222222222222',
    '4242-4242-4242-4242',
    '  4242 4242-4242 4242  ',
  ])('accepts %j', (value) => {
    expect(isCardNumber(value)).toBe(true);
  });

  it.each([
    ['one digit off', '4242 4242 4242 4243'],
    ['not digits', 'abcd efgh ijkl mnop'],
    ['empty', ''],
    ['dots between groups', '4242.4242.4242.4242'],
    ['a tab between groups', '4242\t4242\t4242\t4242'],
    ['Arabic-Indic digits', '٤٢٤٢٤٢٤٢٤٢٤٢٤٢٤٢'],
    ['fullwidth digits', '４２４２４２４２４２４２４２４２'],
    ['letters among digits', '4242 4242 4242 424x'],
  ])('refuses %s', (_why, value) => {
    expect(isCardNumber(value)).toBe(false);
  });

  it('wants 13 to 19 digits, whatever the checksum says', () => {
    for (const length of [12, 13, 16, 19, 20]) {
      const number = withCheckDigit('4'.repeat(length - 1));
      expect(number).toHaveLength(length);
      expect(isCardNumber(number)).toBe(length >= 13 && length <= 19);
    }
  });

  it('checks the Luhn sum on the doubled digits from the right', () => {
    const valid = withCheckDigit('411111111111111');
    expect(isCardNumber(valid)).toBe(true);
    for (let digit = 0; digit <= 9; digit++) {
      const changed = `${valid.slice(0, -1)}${digit}`;
      expect(isCardNumber(changed)).toBe(changed === valid);
    }
  });
});

describe('cleanFields', () => {
  it('cleans up the values', () => {
    expect(
      rows('credentials', [
        ['  Username ', '  me  ', null],
        ['Password', ' pa ss ', null],
        ['Website', '   ', null],
        ['PIN', '0000', true],
      ]),
    ).toEqual([
      { label: 'Username', value: 'me', hidden: false },
      // Masked values are kept exactly as typed.
      { label: 'Password', value: ' pa ss ', hidden: true },
      { label: 'PIN', value: '0000', hidden: true },
    ]);
  });

  it('masks by the label of the kind, whatever the case', () => {
    expect(isHidden('card', 'card NUMBER', '4242')).toBe(true);
    expect(isHidden('card', '  Card Number  ', '4242')).toBe(true);
    expect(isHidden('card', 'cvc', '123')).toBe(true);
    expect(isHidden('credentials', 'PASSWORD')).toBe(true);
    expect(isHidden('card', 'Cardholder', 'Ada')).toBe(false);
    expect(isHidden('card', 'Expiry', '12/30')).toBe(false);
  });

  it.each([
    'Password',
    'Passwort',
    'Mot de passe',
    'Passwd',
    'Passcode',
    'Passphrase',
    'Passport number',
    'pwd',
    'PIN',
    'PIN code',
    'Pin-Code',
    'PİN',
    'pın',
    'Secret',
    'Client secret',
    'Token',
    'Access token',
    'API key',
    'api-key',
    'API_KEY',
    'apikey',
    'Private key',
    'Recovery code',
    'Seed phrase',
    'CVV',
    'CVC',
    'cv2',
    'Security code',
    'Card number',
    'Card Number',
    'Cardnumber',
    'Credit card number',
    'Card no.',
    'Card no',
    'Card num',
    'Card #',
    'PAN',
    'IBAN',
  ])('masks anything labelled %j, in any kind of secret', (label) => {
    expect(isHidden('note', label)).toBe(true);
    expect(isHidden('personal', label)).toBe(true);
  });

  it.each([
    'Phone number',
    'Name',
    'Company',
    'Company address',
    'Website',
    'Username',
    'Email',
    'Pinterest',
    'Opinion',
    'Spanish',
    'Panorama',
    'Card',
    'Cardholder',
    'Card nobody',
    'Épin',
    'Telefonnummer',
  ])('leaves %j visible', (label) => {
    expect(isHidden('personal', label)).toBe(false);
  });

  it('masks a value that is a card number, wherever it is kept', () => {
    expect(isHidden('personal', 'Anything', '4111 1111 1111 1111')).toBe(true);
    expect(isHidden('note', 'Note', ' 4111-1111-1111-1111 ')).toBe(true);
    // but not any long number
    expect(isHidden('personal', 'Phone', '4111 1111 1111 1112')).toBe(false);
    expect(isHidden('personal', 'Phone', '+41 79 123 45 67')).toBe(false);
  });

  it('lets the user say otherwise', () => {
    const [password] = rows('note', [['Password', '  x  ', false]]);
    expect(password).toEqual({ label: 'Password', value: 'x', hidden: false });
    const [name] = rows('personal', [['Name', '  Ada  ', true]]);
    expect(name).toEqual({ label: 'Name', value: '  Ada  ', hidden: true });
    expect(isHidden('credentials', 'Anything', '4111 1111 1111 1111')).toBe(
      true,
    );
    const [card] = rows('card', [
      ['Card number', '4242 4242 4242 4242', false],
    ]);
    expect(card.hidden).toBe(false);
  });

  it('treats a missing hidden like null', () => {
    const [field] = cleanFields('credentials', [
      { label: 'Password', value: 'x' },
    ]);
    expect(field.hidden).toBe(true);
  });

  it('keeps the order and repeated labels', () => {
    const cleaned = rows('note', [
      ['B', '2'],
      ['A', '1'],
      ['B', '3'],
    ]);
    expect(cleaned.map((f) => `${f.label}=${f.value}`)).toEqual([
      'B=2',
      'A=1',
      'B=3',
    ]);
  });

  it('drops rows without a value, masked or not, and even without a label', () => {
    const cleaned = rows('credentials', [
      ['', '', null],
      ['', '   ', null],
      ['Website', '', null],
      ['Password', '    ', true],
      ['Username', 'me', null],
    ]);
    expect(cleaned).toEqual([
      { label: 'Username', value: 'me', hidden: false },
    ]);
  });

  it('accepts any iterable of rows', () => {
    function* generate(): Generator<SecretFieldIn> {
      yield { label: 'Note', value: 'one' };
      yield { label: 'Note', value: 'two' };
    }
    expect(cleanFields('note', generate()).map((f) => f.value)).toEqual([
      'one',
      'two',
    ]);
  });

  it('hands back plain data that the API can send as it is', () => {
    const cleaned = rows('note', [['Note', 'x']]);
    expect(Object.keys(cleaned[0])).toEqual(['label', 'value', 'hidden']);
    expect(JSON.parse(JSON.stringify(cleaned))).toEqual(cleaned);
  });

  it.each<[string, SecretKind, readonly Row[], string]>([
    ['no rows', 'note', [], 'Fill in at least one value.'],
    [
      'only blank rows',
      'note',
      [['Note', '   ', null]],
      'Fill in at least one value.',
    ],
    [
      'a value without a label',
      'note',
      [['', 'text', null]],
      'Every value needs a label, for example “Username”.',
    ],
    [
      'a value with a blank label',
      'note',
      [['   ', 'text', null]],
      'Every value needs a label, for example “Username”.',
    ],
    [
      'a label that is too long',
      'note',
      [['x'.repeat(61), 'text', null]],
      'A label can have at most 60 characters (“xxxxxxxxxxxxxxxxxxxx…”).',
    ],
    [
      'a value that is too long',
      'note',
      [['Note', 'x'.repeat(20_001), null]],
      'The value of “Note” is too long (at most 20000 characters).',
    ],
    [
      'too many values',
      'note',
      Array.from({ length: 41 }, (_, n): Row => [`Field ${n}`, 'x', null]),
      'A secret can have at most 40 values.',
    ],
  ])('refuses %s', (_why, kind, input, message) => {
    expect(() => rows(kind, input)).toThrow(SecretError);
    expect(() => rows(kind, input)).toThrow(message);
  });

  it('has limits that are the documented ones', () => {
    expect([MAX_TITLE, MAX_FIELDS, MAX_LABEL, MAX_VALUE]).toEqual([
      120, 40, 60, 20_000,
    ]);
  });

  it('accepts values right at the limits', () => {
    expect(rows('note', [['x'.repeat(MAX_LABEL), 'text']])).toHaveLength(1);
    expect(rows('note', [['Note', 'x'.repeat(MAX_VALUE)]])).toHaveLength(1);
    const forty = Array.from({ length: MAX_FIELDS }, (_, n): Row => [
      `Field ${n}`,
      'x',
    ]);
    expect(rows('note', forty)).toHaveLength(MAX_FIELDS);
  });

  it('does not count the rows left empty towards the limit of values', () => {
    const input = Array.from({ length: MAX_FIELDS + 1 }, (_, n): Row => [
      `Field ${n}`,
      n === 0 ? '' : 'x',
    ]);
    expect(rows('note', input)).toHaveLength(MAX_FIELDS);
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(rows('note', [['😀'.repeat(MAX_LABEL), 'x']])).toHaveLength(1);
    expect(() => rows('note', [['😀'.repeat(MAX_LABEL + 1), 'x']])).toThrow(
      'A label can have at most 60 characters (“😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀…”).',
    );
    expect(rows('note', [['Note', '😀'.repeat(MAX_VALUE)]])).toHaveLength(1);
    expect(() => rows('note', [['Note', '😀'.repeat(MAX_VALUE + 1)]])).toThrow(
      'too long',
    );
  });

  it('measures a masked value as typed and the others trimmed', () => {
    const padded = `${'x'.repeat(MAX_VALUE)} `;
    expect(() => rows('note', [['Password', padded]])).toThrow('too long');
    expect(rows('note', [['Note', padded]])[0].value).toHaveLength(MAX_VALUE);
  });

  it('names only the start of a label that is far too long', () => {
    const label = `Label ${'x'.repeat(5_000_000)}`;
    expect(() => rows('note', [[label, 'value']])).toThrow(
      'A label can have at most 60 characters (“Label xxxxxxxxxxxxxx…”).',
    );
  });

  it('does not look at the label of a row without a value', () => {
    expect(
      rows('note', [
        ['x'.repeat(5_000_000), '  '],
        ['Note', 'text'],
      ]),
    ).toHaveLength(1);
  });

  it('names the label in the error about its value', () => {
    expect(() =>
      rows('credentials', [['  Username ', 'x'.repeat(MAX_VALUE + 1)]]),
    ).toThrow('The value of “Username” is too long');
  });

  it('refuses a kind it does not know', () => {
    expect(() =>
      // @ts-expect-error the kind of a secret is checked by the type, and at run time too
      cleanFields('diary', [{ label: 'Note', value: 'x' }]),
    ).toThrow(
      'The kind of secret must be one of: personal, credentials, card, note.',
    );
  });
});

describe('preview', () => {
  it('shows the last four digits of a card number, whatever it is called', () => {
    const fields = rows('card', [
      ['Number', '4111 1111 1111 1111'],
      ['Cardholder', 'Ada'],
    ]);
    expect(preview(fields)).toBe('•••• 1111 · Ada');
  });

  it('never shows a masked value', () => {
    const login = rows('credentials', [
      ['Website', 'shop.example'],
      ['Username', 'me'],
      ['Password', 'hunter2'],
    ]);
    expect(preview(login)).toBe('shop.example · me');

    const card = rows('card', [
      ['Cardholder', 'Y. Monney'],
      ['Card number', '4242 4242 4242 1881'],
      ['CVC', '999'],
    ]);
    expect(preview(card)).toBe('•••• 1881 · Y. Monney');
  });

  it('summarizes the secrets of the API tests', () => {
    const login = rows('credentials', [
      ['Website', 'https://shop.example'],
      ['Username', 'yannick@example.com'],
      ['Password', 'hunter2'],
    ]);
    expect(login.map((f) => [f.label, f.hidden])).toEqual([
      ['Website', false],
      ['Username', false],
      ['Password', true],
    ]);
    expect(preview(login)).toBe('https://shop.example · yannick@example.com');

    const visa = rows('card', [
      ['Cardholder', 'Y. Monney'],
      ['Card number', '4242 4242 4242 4242'],
      ['Expiry', '12/30'],
      ['CVC', '123'],
    ]);
    expect(preview(visa)).toBe('•••• 4242 · Y. Monney · 12/30');
    expect(preview(visa)).not.toContain('123');
    expect(preview(visa)).not.toContain('4242 4242');
  });

  it('keeps a replaced password masked', () => {
    const replaced = rows('credentials', [
      ['Username', 'other'],
      ['Password', 'new'],
    ]);
    expect(replaced.map((f) => f.value)).toEqual(['other', 'new']);
    expect(replaced[1].hidden).toBe(true);
  });

  it('puts a line of text on one line and cuts it at 70 characters', () => {
    const note = rows('note', [
      ['Note', `line one\n  line   two ${'x'.repeat(200)}`],
    ]);
    const text = preview(note);
    expect(text.startsWith('line one line two xxx')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text).toHaveLength(70);
  });

  it('cuts at exactly 70 characters', () => {
    const exact = [{ label: 'Note', value: 'x'.repeat(70), hidden: false }];
    expect(preview(exact)).toBe('x'.repeat(70));
    const over = [{ label: 'Note', value: 'x'.repeat(71), hidden: false }];
    expect(preview(over)).toBe(`${'x'.repeat(69)}…`);
  });

  it('cuts between characters, not inside an emoji', () => {
    const text = preview([
      { label: 'Note', value: '😀'.repeat(100), hidden: false },
    ]);
    expect(text).toBe(`${'😀'.repeat(69)}…`);
    expect(Array.from(text)).toHaveLength(70);
  });

  it('measures the joined text, with its separators', () => {
    const half = 'y'.repeat(34);
    const fields = [
      { label: 'A', value: half, hidden: false },
      { label: 'B', value: half, hidden: false },
    ];
    // 34 + " · " + 34 is 71 characters
    expect(preview(fields)).toBe(`${half} · ${'y'.repeat(32)}…`);
  });

  it('keeps the first three parts', () => {
    const fields = rows('note', [
      ['A', 'one'],
      ['B', 'two'],
      ['C', 'three'],
      ['D', 'four'],
    ]);
    expect(preview(fields)).toBe('one · two · three');
  });

  it('puts the card numbers first, then the visible values in order', () => {
    const fields = rows('note', [
      ['Holder', 'Ada'],
      ['Card 1', '4242 4242 4242 4242'],
      ['Notes', 'first card'],
      ['Card 2', '5555 5555 5555 4444'],
    ]);
    expect(preview(fields)).toBe('•••• 4242 · •••• 4444 · Ada');
  });

  it('shows nothing for values that are all masked', () => {
    const fields = rows('credentials', [
      ['Password', 'a'],
      ['PIN', 'b'],
    ]);
    expect(preview(fields)).toBe('');
    expect(preview([])).toBe('');
  });

  it('shows no digits for a card number field without any', () => {
    const fields = [
      { label: 'Card number', value: 'on file', hidden: true },
      { label: 'Holder', value: 'Ada', hidden: false },
    ];
    expect(preview(fields)).toBe('Ada');
  });

  it('shows the digits of a card number field that is not a number', () => {
    const fields = [{ label: 'Card number', value: '12345', hidden: true }];
    expect(preview(fields)).toBe('•••• 2345');
  });

  it('takes the last four digits in any script', () => {
    const arabic = [
      { label: 'Card number', value: '٤٢٤٢ ٤٢٤٢ ٤٢٤٢ ١٨٨١', hidden: true },
    ];
    expect(preview(arabic)).toBe('•••• ١٨٨١');
    // each digit of the mathematical alphanumerics is two UTF-16 code units
    const astral = [{ label: 'Card number', value: '𝟏𝟐𝟑𝟒𝟓𝟔', hidden: true }];
    expect(preview(astral)).toBe('•••• 𝟑𝟒𝟓𝟔');
  });

  it('takes the last four digits of a number with separators', () => {
    const fields = [{ label: 'x', value: '4111-1111-1111-1111', hidden: true }];
    expect(preview(fields)).toBe('•••• 1111');
    // a number that fails the checksum is only a card number by its label
    const mistyped = [
      { label: 'x', value: '4242-4242-4242-1881', hidden: true },
      { label: 'Card number', value: '4242-4242-4242-1881', hidden: true },
    ];
    expect(preview(mistyped)).toBe('•••• 1881');
  });

  it('hides a private value that is not a card number completely', () => {
    const fields = [
      { label: 'Phone', value: '4111 1111 1111 1112', hidden: true },
      { label: 'CVC', value: '123', hidden: true },
    ];
    expect(preview(fields)).toBe('');
  });

  it('shows a number the user chose not to hide', () => {
    const fields = [
      { label: 'Card number', value: '4242 4242 4242 4242', hidden: false },
    ];
    expect(preview(fields)).toBe('4242 4242 4242 4242');
  });
});
