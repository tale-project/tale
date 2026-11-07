// Whether the label of a value names something to keep private. The server
// hides such a value (`backend/domains/secrets/vault.ts`) and the form masks it
// as it is typed (`app/features/secrets`): one pattern, which both import.

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

/** Whether a value labelled so is private: a password, a PIN, a card number, a token. */
export function isPrivateLabel(label: string): boolean {
  return PRIVATE_LABEL.test(dotless(label));
}
