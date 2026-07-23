/**
 * Checksum algorithms for national identity numbers — the code half every
 * locale dataset's `nationalIds[].checksum` name resolves to.
 *
 * Contract: each function takes a pre-normalized string (separators
 * stripped, uppercased where letters matter — the dispatch in
 * `factory.ts` owns normalization) and returns a boolean. None throw; a
 * malformed input returns false, so `pattern.validate` needs no
 * try/catch around them. Without these gates, any SKU or order number
 * matching an ID's shape would read as that ID.
 */

/**
 * ICAO 9303 MRZ check digit (passports, German Personalausweis, residence
 * permits): digits map to their value, letters A–Z to 10–35; the first
 * N−1 characters are weighted cyclically [7, 3, 1] and the sum mod 10
 * must equal the final character's value.
 */
export function icao9303Check(input: string, expectedLength: number): boolean {
  if (input.length !== expectedLength) return false;
  const charValue = (c: string): number => {
    const code = c.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 90) return code - 55;
    return -1;
  };
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < expectedLength - 1; i++) {
    const v = charValue(input[i] ?? '');
    if (v < 0) return false;
    sum += v * weights[i % 3];
  }
  const lastVal = charValue(input[expectedLength - 1] ?? '');
  return lastVal >= 0 && lastVal === sum % 10;
}

/** Luhn mod-10 (CA SIN, GR AMKA, card-style IDs). Digits-only input. */
export function luhnCheck(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Weighted digit sum — the shared primitive of the mod-11 family. */
function weightedDigitSum(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  return sum;
}

/**
 * Dutch BSN: 9 digits, weights [9..2] over the first 8, sum mod 11 equals
 * the 9th digit; residue 10 is invalid outright.
 */
export function nlBsnCheck(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const sum = weightedDigitSum(digits, [9, 8, 7, 6, 5, 4, 3, 2]);
  const check = sum % 11;
  if (check === 10) return false;
  return check === Number(digits[8]);
}

/**
 * Brazilian CPF: 11 digits with two cascading mod-11 check digits.
 * Repeated-digit CPFs pass the math but are the classic dummy strings —
 * rejected up front.
 */
export function brCpfCheck(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const d1Sum = weightedDigitSum(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d1 = ((d1Sum * 10) % 11) % 10;
  if (d1 !== Number(digits[9])) return false;
  const d2Sum = weightedDigitSum(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = ((d2Sum * 10) % 11) % 10;
  return d2 === Number(digits[10]);
}

/**
 * Chinese resident identity card (居民身份证), ISO 7064 mod 11-2: 17
 * digits plus a check character (digit or X), weights are powers of two
 * mod 11 right-to-left, the sum mod 11 maps through a fixed table to the
 * expected check character. The historical 15-digit form has no check
 * digit and is out of scope.
 */
export function zhResidentIdCheck(input: string): boolean {
  if (!/^\d{17}[\dX]$/.test(input)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkChars = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += (input.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  return checkChars[sum % 11] === input[17];
}

/**
 * Verhoeff (Indian Aadhaar) — dihedral-group D5 table walk. Catches every
 * single-digit error and adjacent transposition, which Luhn does not.
 */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffCheck(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split('').toReversed();
  for (let i = 0; i < reversed.length; i++) {
    const digit = Number(reversed[i]);
    const permRow = VERHOEFF_P[i % 8];
    const dRow = VERHOEFF_D[c];
    if (!permRow || !dRow) return false;
    const p = permRow[digit];
    if (p === undefined) return false;
    const next = dRow[p];
    if (next === undefined) return false;
    c = next;
  }
  return c === 0;
}

/**
 * Polish PESEL: 11 digits, weights [1,3,7,9,…] over the first 10; the
 * complement of the sum mod 10 must equal the final digit. The embedded
 * birth date is not decoded — century-offset validation buys almost
 * nothing once the check digit holds.
 */
export function peselMod10Check(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weightedDigitSum(digits, w);
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/**
 * Irish PPS number: 7 digits + check letter + optional W/H suffix.
 * Weights 8..2 over the digits (an H suffix contributes 9×8), sum mod 23
 * maps to the letter (residue 0 → W at position 23).
 */
export function ieMod23Check(input: string): boolean {
  if (!/^\d{7}[A-W](?:[WH])?$/.test(input)) return false;
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += (input.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  if (input.length === 9) {
    const sfx = input[8];
    if (sfx === 'H') sum += 9 * 8;
  }
  const expected = sum % 23;
  const letter = input.charCodeAt(7) - 64;
  return (expected === 0 ? 23 : expected) === letter;
}

/**
 * EAN-13 check digit — Swiss AHV/AVS numbers are EAN-13 with the `756`
 * country prefix. Weights alternate [1, 3] over the first 12 digits.
 */
export function ean13Check(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = digits.charCodeAt(i) - 48;
    sum += d * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits[12]);
}

/**
 * Spanish DNI/NIE letter: the trailing letter is the number mod 23 read
 * from a fixed alphabet; NIE prefixes X/Y/Z substitute as 0/1/2.
 */
const DNI_NIE_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function esDniCheck(input: string): boolean {
  if (!/^\d{8}[A-Z]$/.test(input)) return false;
  const number = Number(input.slice(0, 8));
  return DNI_NIE_LETTERS[number % 23] === input[8];
}

export function esNieCheck(input: string): boolean {
  if (!/^[XYZ]\d{7}[A-Z]$/.test(input)) return false;
  const prefixDigit = input[0] === 'X' ? '0' : input[0] === 'Y' ? '1' : '2';
  const number = Number(prefixDigit + input.slice(1, 8));
  return DNI_NIE_LETTERS[number % 23] === input[8];
}

/**
 * Belgian National Register Number: 11 digits; the last two are
 * 97 − (first nine mod 97), with 2 000 000 000 added to the base for
 * people born from 2000 on. Both eras are accepted.
 */
export function beNrnCheck(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const base = Number(digits.slice(0, 9));
  const check = Number(digits.slice(9, 11));
  const expected20th = 97 - (base % 97);
  const expected21st = 97 - ((2_000_000_000 + base) % 97);
  return check === expected20th || check === expected21st;
}

/** Australian Tax File Number: 9 digits, weighted sum divisible by 11. */
export function auTfnCheck(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const weights = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  return sum % 11 === 0;
}

/**
 * New Zealand IRD number: 8–9 digits, primary weighted mod-11 with a
 * secondary weight set when the primary yields 10 — Inland Revenue's
 * published two-stage algorithm.
 */
export function nzIrdCheck(digits: string): boolean {
  if (!/^\d{8,9}$/.test(digits)) return false;
  const padded = digits.padStart(9, '0');
  const primary = [3, 2, 7, 6, 5, 4, 3, 2];
  const secondary = [7, 4, 3, 2, 5, 2, 7, 6];
  const body = padded.slice(0, 8);
  const check = Number(padded[8]);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += (body.charCodeAt(i) - 48) * (primary[i] ?? 0);
  }
  let remainder = sum % 11;
  if (remainder === 0) return check === 0;
  let computed = 11 - remainder;
  if (computed !== 10) return computed === check;
  sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += (body.charCodeAt(i) - 48) * (secondary[i] ?? 0);
  }
  remainder = sum % 11;
  if (remainder === 0) return check === 0;
  computed = 11 - remainder;
  if (computed === 10) return false;
  return computed === check;
}

/**
 * Argentinian CUIL/CUIT: 11 digits, weights [5,4,3,2,7,6,5,4,3,2]; the
 * check is 11 − (sum mod 11) with 11 → 0 and 10 invalid.
 */
export function arCuilCheck(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  const remainder = sum % 11;
  let computed = 11 - remainder;
  if (computed === 11) computed = 0;
  if (computed === 10) return false;
  return computed === Number(digits[10]);
}

/**
 * Hong Kong HKID: one or two letters + 6 digits + check char (digit or
 * A). Characters value digits as themselves and letters as 10–35; a
 * single-letter prefix is padded with a space valued 36. Weighted 9..2,
 * the check character (A = 10) must bring the total to a multiple of 11.
 */
export function hkHkidCheck(input: string): boolean {
  if (!/^[A-Z]{1,2}\d{6}[A0-9]$/.test(input)) return false;
  const padded = input.length === 8 ? ' ' + input : input;
  const charValue = (c: string): number => {
    if (c === ' ') return 36;
    const code = c.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 90) return code - 55;
    return -1;
  };
  const weights = [9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const v = charValue(padded[i] ?? '');
    if (v < 0) return false;
    sum += v * (weights[i] ?? 0);
  }
  const checkChar = padded[8] ?? '';
  const checkValue = checkChar === 'A' ? 10 : Number(checkChar);
  return (sum + checkValue) % 11 === 0;
}

/**
 * Mexican CURP: 18 characters, the final digit a mod-10 check over the
 * first 17 with descending weights 18..2 (letters valued 10–35, Ñ as 24).
 */
export function mxCurpCheck(input: string): boolean {
  if (!/^[A-Z]{4}\d{6}[HM][A-Z]{5}[0-9A-Z]\d$/.test(input)) return false;
  const charValue = (c: string): number => {
    const code = c.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 65 && code <= 90) return code - 55;
    if (c === 'Ñ') return 24;
    return -1;
  };
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = charValue(input[i] ?? '');
    if (v < 0) return false;
    sum += v * (18 - i);
  }
  return (10 - (sum % 10)) % 10 === Number(input[17]);
}

/**
 * German Steuer-ID: 11 digits, no leading zero. The first ten must have
 * either exactly one digit twice (one missing) or one digit three times
 * (two missing); the 11th is an ISO 7064 MOD 11,10 check digit.
 */
export function deSteuerIdCheck(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (digits[0] === '0') return false;
  const body = digits.slice(0, 10);
  const freq = new Map<string, number>();
  for (const ch of body) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  const counts = [...freq.values()].sort((a, b) => b - a);
  const missing = 10 - freq.size;
  const okStructure =
    (counts[0] === 2 &&
      missing === 1 &&
      counts.slice(1).every((c) => c === 1)) ||
    (counts[0] === 3 && missing === 2 && counts.slice(1).every((c) => c === 1));
  if (!okStructure) return false;
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (body.charCodeAt(i) - 48 + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  return (11 - product) % 10 === Number(digits[10]);
}

/**
 * Romanian CNP: 13 digits, weights [2,7,9,1,4,6,3,5,8,2,7,9] over the
 * first 12, sum mod 11 (residue 10 becomes 1) equals the last digit.
 */
export function roCnpCheck(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  const weights = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  let expected = sum % 11;
  if (expected === 10) expected = 1;
  return expected === Number(digits[12]);
}

/**
 * Turkish TC Kimlik No: 11 digits, no leading zero, two cascading checks
 * — d10 from the odd/even sums of the first nine, d11 from the total of
 * the first ten.
 */
export function trTcknCheck(digits: string): boolean {
  if (!/^[1-9]\d{10}$/.test(digits)) return false;
  let oddSum = 0;
  let evenSum = 0;
  let totalSum = 0;
  for (let i = 0; i < 9; i++) {
    const d = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) oddSum += d;
    else evenSum += d;
    totalSum += d;
  }
  const d10 = (oddSum * 7 - evenSum + 100) % 10;
  if (d10 !== Number(digits[9])) return false;
  totalSum += d10;
  return totalSum % 10 === Number(digits[10]);
}

/**
 * Swedish personnummer: Luhn over the 10-digit form; a 12-digit input
 * drops its century prefix first.
 */
export function sePersonnummerCheck(digits: string): boolean {
  if (digits.length === 12) digits = digits.slice(2);
  if (!/^\d{10}$/.test(digits)) return false;
  return luhnCheck(digits);
}

/**
 * Israeli Teudat Zehut: up to 9 digits, zero-padded, alternating ×1/×2
 * weights with digit-sum folding; total must be divisible by 10.
 */
export function ilTeudatZehutCheck(digits: string): boolean {
  if (!/^\d{4,9}$/.test(digits)) return false;
  const padded = digits.padStart(9, '0');
  let total = 0;
  for (let i = 0; i < 9; i++) {
    let value = (padded.charCodeAt(i) - 48) * (1 + (i % 2));
    if (value > 9) value -= 9;
    total += value;
  }
  return total % 10 === 0;
}

/**
 * Brazilian CNPJ: 14 digits, two cascading mod-11 check digits with the
 * published weight tables; repeated-digit dummies rejected up front.
 */
export function brCnpjCheck(digits: string): boolean {
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  const d13Weights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d14Weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (digits.charCodeAt(i) - 48) * (d13Weights[i] ?? 0);
  }
  let rem = sum % 11;
  const d13 = rem < 2 ? 0 : 11 - rem;
  if (d13 !== Number(digits[12])) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += (digits.charCodeAt(i) - 48) * (d14Weights[i] ?? 0);
  }
  rem = sum % 11;
  const d14 = rem < 2 ? 0 : 11 - rem;
  return d14 === Number(digits[13]);
}

/**
 * French NIR (numéro de sécurité sociale): 13-digit body + 2-digit key,
 * key = 97 − (body mod 97). Corsican department codes 2A/2B substitute as
 * 19/18 before the mod. A 13-digit body fits a double exactly.
 */
export function frNirCheck(input: string): boolean {
  let normalized = input.replace(/\s/g, '').toUpperCase();
  if (normalized.length === 15) {
    if (normalized.slice(5, 7) === '2A') {
      normalized = normalized.slice(0, 5) + '19' + normalized.slice(7);
    } else if (normalized.slice(5, 7) === '2B') {
      normalized = normalized.slice(0, 5) + '18' + normalized.slice(7);
    }
  }
  if (!/^\d{15}$/.test(normalized)) return false;
  const body = normalized.slice(0, 13);
  const check = Number(normalized.slice(13, 15));
  return 97 - (Number(body) % 97) === check;
}

/**
 * Italian Codice Fiscale: 16 characters; odd positions (1-indexed) value
 * through the odd table, even through the even table, sum mod 26 maps to
 * the final check letter.
 */
const CF_ODD: Record<string, number> = {
  '0': 1,
  '1': 0,
  '2': 5,
  '3': 7,
  '4': 9,
  '5': 13,
  '6': 15,
  '7': 17,
  '8': 19,
  '9': 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
};
const CF_EVEN: Record<string, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
  G: 6,
  H: 7,
  I: 8,
  J: 9,
  K: 10,
  L: 11,
  M: 12,
  N: 13,
  O: 14,
  P: 15,
  Q: 16,
  R: 17,
  S: 18,
  T: 19,
  U: 20,
  V: 21,
  W: 22,
  X: 23,
  Y: 24,
  Z: 25,
};

export function itCodiceFiscaleCheck(input: string): boolean {
  if (!/^[0-9A-Z]{16}$/.test(input)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = input[i] ?? '';
    const v = (i + 1) % 2 === 1 ? CF_ODD[c] : CF_EVEN[c];
    if (v === undefined) return false;
    sum += v;
  }
  return String.fromCharCode(65 + (sum % 26)) === input[15];
}

/**
 * Japanese My Number (個人番号): 12 digits. Counting positions from the
 * right of the 11-digit body, weight q_n is n+1 for n ≤ 6 else n−5; the
 * check is 0 when the sum mod 11 is ≤ 1, otherwise 11 − remainder.
 */
export function jpMyNumberCheck(digits: string): boolean {
  if (!/^\d{12}$/.test(digits)) return false;
  let sum = 0;
  for (let n = 1; n <= 11; n++) {
    const q = n <= 6 ? n + 1 : n - 5;
    const d = digits.charCodeAt(11 - n) - 48;
    sum += d * q;
  }
  const rem = sum % 11;
  const check = rem <= 1 ? 0 : 11 - rem;
  return check === Number(digits[11]);
}

/**
 * Korean Resident Registration Number (주민등록번호): 13 digits, weights
 * [2..9, 2..5] over the first 12, check = (11 − sum mod 11) mod 10.
 */
export function krRrnCheck(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

/**
 * Russian INN, 12-digit personal form: two weighted mod-11-mod-10 check
 * digits at positions 11 and 12.
 */
export function ruInn12Check(digits: string): boolean {
  if (!/^\d{12}$/.test(digits)) return false;
  const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += (digits.charCodeAt(i) - 48) * (w11[i] ?? 0);
  }
  if ((sum % 11) % 10 !== Number(digits[10])) return false;
  sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += (digits.charCodeAt(i) - 48) * (w12[i] ?? 0);
  }
  return (sum % 11) % 10 === Number(digits[11]);
}

/**
 * Portuguese NIF: 9 digits, weights [9..2] over the first 8 mod 11;
 * remainder below 2 gives check 0, else 11 − remainder.
 */
export function ptNifCheck(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const sum = weightedDigitSum(digits, [9, 8, 7, 6, 5, 4, 3, 2]);
  const rem = sum % 11;
  const check = rem < 2 ? 0 : 11 - rem;
  return check === Number(digits[8]);
}

/**
 * Czech rodné číslo: 9 digits (pre-1954, no check) or 10 digits where the
 * whole number is divisible by 11 — with the historical exception that a
 * body residue of 10 was emitted as check digit 0.
 */
export function czRcCheck(digits: string): boolean {
  if (!/^\d{9,10}$/.test(digits)) return false;
  if (digits.length === 9) return true;
  // BigInt sidesteps precision on the 10-digit integer.
  const BIG_11 = BigInt(11);
  const BIG_10 = BigInt(10);
  const BIG_0 = BigInt(0);
  const bn = BigInt(digits);
  if (bn % BIG_11 === BIG_0) return true;
  const body = bn / BIG_10;
  const check = Number(bn % BIG_10);
  return Number(body % BIG_11) === 10 && check === 0;
}

/**
 * Danish CPR: 10 digits, strict mod-11 with weights [4,3,2,7,6,5,4,3,2,1].
 * CPRs issued after 2007 may legitimately fail this — locales that want
 * format-only matching simply omit the checksum in their dataset.
 */
export function dkCprCheck(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [4, 3, 2, 7, 6, 5, 4, 3, 2, 1];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  return sum % 11 === 0;
}

/**
 * Malaysian MyKad: 12 digits with no formal checksum; the leading six
 * must form a plausible YYMMDD date, which filters most random runs.
 */
export function myMykadCheck(digits: string): boolean {
  if (!/^\d{12}$/.test(digits)) return false;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}

/**
 * Singapore NRIC/FIN: prefix letter + 7 digits + check letter. Weights
 * [2,7,6,5,4,3,2]; T/G/M prefixes add 4; the mod-11 residue indexes the
 * citizen table (S/T) or the FIN table (F/G/M).
 */
const SG_NRIC_STAY = ['J', 'Z', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
const SG_NRIC_FIN = ['X', 'W', 'U', 'T', 'R', 'Q', 'P', 'N', 'M', 'L', 'K'];

export function sgNricCheck(input: string): boolean {
  if (!/^[STFGM]\d{7}[A-Z]$/.test(input)) return false;
  const prefix = input[0] ?? '';
  const weights = [2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += (input.charCodeAt(1 + i) - 48) * (weights[i] ?? 0);
  }
  if (prefix === 'T' || prefix === 'G' || prefix === 'M') sum += 4;
  const rem = sum % 11;
  const table = prefix === 'S' || prefix === 'T' ? SG_NRIC_STAY : SG_NRIC_FIN;
  return table[rem] === input[8];
}
