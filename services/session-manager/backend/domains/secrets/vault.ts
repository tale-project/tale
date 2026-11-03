// The Secrets tab: what each kind of secret holds, how its fields are cleaned
// up and how a list summarizes it.

import type {
  FieldSpec,
  SecretField,
  SecretFieldIn,
  SecretKind,
  SecretKindInfo,
} from '../../../lib/api/schemas.ts';
import {
  longerThan,
  MAX_FIELDS,
  MAX_LABEL,
  MAX_TITLE,
  MAX_VALUE,
} from '../../../lib/secret-limits.ts';

export type { FieldSpec, SecretField };

/** What the Secrets tab knows of a kind of secret; `/api/meta` lists it as is. */
export type KindSpec = SecretKindInfo;

/** How much of a label too long the refusal shows. */
const LABEL_HINT = 20;
const PREVIEW_LENGTH = 70;
const PREVIEW_FIELDS = 3;

/** `hidden`: masked in the web page until the user reveals it. */
function field(
  label: string,
  { hidden = false, multiline = false } = {},
): FieldSpec {
  return { label, hidden, multiline };
}

export const KINDS: readonly KindSpec[] = [
  {
    key: 'personal',
    label: 'Personal information',
    fields: [
      field('Name'),
      field('Email'),
      field('Phone'),
      field('Address', { multiline: true }),
      field('Company'),
      field('Company address', { multiline: true }),
    ],
  },
  {
    key: 'credentials',
    label: 'Credentials',
    fields: [
      field('Website'),
      field('Username'),
      field('Password', { hidden: true }),
    ],
  },
  {
    key: 'card',
    label: 'Credit card',
    fields: [
      field('Cardholder'),
      field('Card number', { hidden: true }),
      field('Expiry'),
      field('CVC', { hidden: true }),
    ],
  },
  {
    key: 'note',
    label: 'Note',
    fields: [field('Note', { multiline: true })],
  },
];
export const KIND_KEYS: readonly SecretKind[] = KINDS.map((kind) => kind.key);

const CARD_NUMBER = 'card number';

// JavaScript's \b only knows ASCII letters; the label of a secret can be in any
// language ("Épin" is not a PIN), so the word edges are spelled out.
const WORD_START = String.raw`(?<![\p{L}\p{N}_])`;
const WORD_END = String.raw`(?![\p{L}\p{N}_])`;

// Labels that name something to keep private, in any kind of secret and any
// wording ("Passwort", "Card no.", "PIN"). "pass" is deliberately loose: it
// covers password, passwd, passcode, passphrase and Passwort, and it also masks
// a "Passport number", which is the safe way to be wrong.
const PRIVATE_LABEL = new RegExp(
  [
    'pass',
    'pwd',
    `${WORD_START}pin${WORD_END}`,
    'secret',
    'token',
    String.raw`api[ _-]?key`,
    'private key',
    'recovery',
    'seed phrase',
    `${WORD_START}cv[cv2]${WORD_END}`,
    'security code',
    String.raw`card\s*(?:number|no${WORD_END}|num${WORD_END}|#)`,
    `${WORD_START}pan${WORD_END}`,
    'iban',
  ].join('|'),
  'iu',
);

// A Turkish label can say "PİN" (dotted capital) or "pın" (dotless small): both
// are a PIN, but a case-insensitive match of JavaScript does not read İ and ı
// as an i.
function dotless(label: string): string {
  return label.replace(/[İı]/gu, 'i');
}

/** Unusable input; the message is for the person using the app. */
export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

function specOf(kind: SecretKind): KindSpec {
  const spec = KINDS.find((candidate) => candidate.key === kind);
  if (!spec) {
    throw new SecretError(
      `The kind of secret must be one of: ${KIND_KEYS.join(', ')}.`,
    );
  }
  return spec;
}

export function cleanTitle(raw: string): string {
  const title = raw.trim();
  if (title === '' || longerThan(title, MAX_TITLE)) {
    throw new SecretError(`The title must be 1-${MAX_TITLE} characters long.`);
  }
  return title;
}

/** Does the value look like a payment card number (13 to 19 digits that pass the Luhn check)? */
export function isCardNumber(value: string): boolean {
  const digits = value.trim().replace(/[ -]/gu, '');
  if (!/^[0-9]{13,19}$/u.test(digits)) return false;
  let total = 0;
  for (let position = 0; position < digits.length; position++) {
    const digit = Number(digits[digits.length - 1 - position]);
    const doubled = position % 2 === 1 ? digit * 2 : digit;
    total += doubled > 9 ? doubled - 9 : doubled;
  }
  return total % 10 === 0;
}

/**
 * The fields in the order given. Rows without a value are dropped (a template
 * row the user left empty). `hidden` null or missing means the default: masked
 * are the fields that the kind masks (passwords, card numbers), whatever else
 * is named like something private or holds a card number.
 */
export function cleanFields(
  kind: SecretKind,
  fields: Iterable<SecretFieldIn>,
): SecretField[] {
  const defaults = new Map(
    specOf(kind).fields.map((spec) => [spec.label.toLowerCase(), spec.hidden]),
  );
  const cleaned: SecretField[] = [];
  for (const { label: rawLabel, value: rawValue, hidden } of fields) {
    // A row without a value is dropped, with its label, before anything looks at that.
    if (rawValue.trim() === '') continue;
    const label = rawLabel.trim();
    if (label === '') {
      throw new SecretError(
        'Every value needs a label, for example “Username”.',
      );
    }
    // Before the label is matched against the patterns below: a label of
    // millions of characters is refused unread.
    if (longerThan(label, MAX_LABEL)) {
      throw new SecretError(
        `A label can have at most ${MAX_LABEL} characters (“${Array.from(
          label.slice(0, 2 * LABEL_HINT),
        )
          .slice(0, LABEL_HINT)
          .join('')}…”).`,
      );
    }
    const masked =
      hidden ??
      (defaults.get(label.toLowerCase()) === true ||
        PRIVATE_LABEL.test(dotless(label)) ||
        isCardNumber(rawValue));
    // A masked value is kept as typed (a password may start or end with a
    // space); the others are trimmed.
    const value = masked ? rawValue : rawValue.trim();
    if (longerThan(value, MAX_VALUE)) {
      throw new SecretError(
        `The value of “${label}” is too long (at most ${MAX_VALUE} characters).`,
      );
    }
    cleaned.push({ label, value, hidden: masked });
  }
  if (cleaned.length === 0) {
    throw new SecretError('Fill in at least one value.');
  }
  if (cleaned.length > MAX_FIELDS) {
    throw new SecretError(`A secret can have at most ${MAX_FIELDS} values.`);
  }
  return cleaned;
}

/** A one-line summary for lists that shows no masked value (a card number shows its last four digits). */
export function preview(fields: Iterable<SecretField>): string {
  const all = Array.from(fields);
  const parts: string[] = [];
  for (const { label, value, hidden } of all) {
    const isCard = label.toLowerCase() === CARD_NUMBER || isCardNumber(value);
    // Digits of any script: a card number can be typed in Arabic-Indic digits.
    const digits = Array.from(value.replace(/[^\p{Nd}]/gu, ''));
    if (hidden && isCard && digits.length > 0) {
      parts.push(`•••• ${digits.slice(-4).join('')}`);
    }
  }
  for (const { value, hidden } of all) {
    if (!hidden) parts.push(value.trim().replace(/\s+/gu, ' '));
  }
  const text = parts.slice(0, PREVIEW_FIELDS).join(' · ');
  const characters = Array.from(text);
  return characters.length <= PREVIEW_LENGTH
    ? text
    : `${characters.slice(0, PREVIEW_LENGTH - 1).join('')}…`;
}
