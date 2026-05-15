/**
 * Shared checksum builders for national identity numbers.
 *
 * Each algorithm appears in multiple national-ID specs:
 *   - ICAO 9303 MRZ check digit:  DE Personalausweis, machine-readable
 *                                 passports, residence permits
 *   - Luhn (mod-10):              CA SIN, GR AMKA
 *   - Mod-11:                     NL BSN, BR CPF, JP My Number
 *   - Mod-11-2 (ISO 7064):        CN 身份证
 *   - Verhoeff:                   IN Aadhaar
 *   - EAN-13:                     CH AHV/AVS, EU VAT (rare)
 *   - mod-11 (weighted):          ES DNI/NIE letter, BE NRN, AU TFN,
 *                                 NZ IRD, AR CUIL/CUIT, MX RFC
 *
 * Each function takes a normalized string (already uppercased, separators
 * stripped) and returns boolean. None throw; an invalid input returns
 * `false` rather than raising, so callers (`pattern.validate`) don't need
 * a try/catch around them.
 */

/**
 * ICAO 9303 MRZ check digit.
 *
 * Digits 0-9 map to 0..9; letters A..Z map to 10..35. First N-1 chars
 * multiplied by cyclic weights [7, 3, 1]; the sum modulo 10 must equal
 * the value of the Nth character.
 *
 * Without this gate, any 9-char SKU starting with an allowed letter
 * (`T12345678`, `K00000001`) would falsely look like a German Personalausweis.
 */
export function icao9303Check(input: string, expectedLength: number): boolean {
  if (input.length !== expectedLength) return false;
  const charValue = (c: string): number => {
    const code = c.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48; // 0-9
    if (code >= 65 && code <= 90) return code - 55; // A-Z = 10-35
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

/** Luhn (mod-10) for credit-card-style check digits. Digits-only input. */
export function luhnCheck(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = (digits.charCodeAt(i) - 48) | 0;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Compute a weighted digit sum. Shared primitive for every mod-11 / mod-23
 * scheme — each per-country function below calls this with its own
 * weights list.
 */
function weightedDigitSum(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  return sum;
}

/**
 * Dutch BSN: 9 digits. Apply weights [9, 8, 7, 6, 5, 4, 3, 2] to the first
 * 8 digits, sum, modulo 11, must equal the 9th digit. (For pre-2007
 * "sofinummer", the same formula but mod 11 ≡ 10 was invalid; we accept
 * mod ≡ 10 only if last digit is the same residue, which BSN doesn't
 * allow — so any candidate with `sum % 11 === 10` is rejected as
 * non-BSN.)
 */
export function nlBsnCheck(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const sum = weightedDigitSum(digits, [9, 8, 7, 6, 5, 4, 3, 2]);
  const check = sum % 11;
  if (check === 10) return false;
  return check === Number(digits[8]);
}

/**
 * Brazilian CPF: 11 digits. Two cascading mod-11 checks. The 10th digit
 * is the first check (weights 10..2 over digits 1..9, mod 11; remainder
 * <2 → 0). The 11th digit is the second check (weights 11..2 over
 * digits 1..10). Repeated-digit CPFs (`11111111111`) are explicitly
 * invalid even though they pass the math — these are the most common
 * test/dummy strings.
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
 * Chinese resident-identity-card (居民身份证) check digit — ISO 7064 mod 11-2.
 *
 * 18-character form: 17 digits + 1 check character (digit or `X`). Weights
 * are powers of 2 mod 11 reading right-to-left: [7, 9, 10, 5, 8, 4, 2, 1,
 * 6, 3, 7, 9, 10, 5, 8, 4, 2]. Sum mod 11 maps via [1, 0, X, 9, 8, 7, 6,
 * 5, 4, 3, 2] to the expected check character.
 *
 * The older 15-digit form has no check digit; we don't try to validate
 * those and the regex pattern explicitly requires 18 chars.
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
 * Verhoeff check — used by Indian Aadhaar and a few other modern IDs.
 *
 * The Verhoeff algorithm uses dihedral group D5 multiplication and a
 * permutation table. It detects every single-digit error and every
 * adjacent-digit transposition (Luhn misses some). Implementation is the
 * classical table-driven form; see Verhoeff (1969).
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
 * Polish PESEL: 11 digits. Weights [1, 3, 7, 9, 1, 3, 7, 9, 1, 3] over
 * the first 10 digits, mod 10, must combine with the 11th digit so the
 * total mod 10 is zero (`(10 - sum % 10) % 10 === d11`).
 *
 * PESEL also encodes a birth date in the first 6 digits, but the date
 * portion is not validated here — invalid dates inside a check-digit-
 * consistent PESEL are exceedingly rare and would require century-rollover
 * decoding (PESEL uses month + 20/40/60/80 offsets to mean centuries).
 */
export function peselMod10Check(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weightedDigitSum(digits, w);
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/**
 * Irish PPS Number (Personal Public Service): 7 digits + 1 check letter +
 * optional `W`/`H` suffix (used for spouse / married-female forms).
 *
 * Weights 8..2 over the seven digits, plus an extra (suffix character
 * value, optional) if present. Sum mod 23 → 0..22, mapped to W, A..V,
 * W → W. The historical "W" letter at position 8 is actually a stand-in
 * for the suffix.
 */
export function ieMod23Check(input: string): boolean {
  if (!/^\d{7}[A-W](?:[WH])?$/.test(input)) return false;
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += (input.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  if (input.length === 9) {
    // Suffix contributes: W → 0, H → 8. (W marks no-suffix; old standard.)
    const sfx = input[8];
    if (sfx === 'H') sum += 9 * 8;
  }
  const expected = sum % 23;
  const letter = input.charCodeAt(7) - 64; // A=1, B=2, ..., W=23
  return (expected === 0 ? 23 : expected) === letter;
}

/**
 * EAN-13 check digit — used by Swiss AHV/AVS (Versichertennummer).
 *
 * Swiss AHV-13 is a 13-digit number prefixed by `756` (the Swiss country
 * code in EAN). Weights cycle `[1, 3]` over the first 12 digits, summed,
 * then the check digit equals `(10 - sum % 10) % 10`.
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
 * Spanish DNI/NIE letter check.
 *
 * DNI: 8 digits + letter. NIE: prefix letter (X/Y/Z) + 7 digits + letter.
 * The trailing letter is `LETTERS[number mod 23]` where number is the 8
 * digits (DNI) or the digits with the NIE prefix replaced (X→0, Y→1, Z→2).
 */
const DNI_NIE_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function esDniCheck(input: string): boolean {
  if (!/^\d{8}[A-Z]$/.test(input)) return false;
  const number = Number(input.slice(0, 8));
  const expected = DNI_NIE_LETTERS[number % 23];
  return expected === input[8];
}

export function esNieCheck(input: string): boolean {
  if (!/^[XYZ]\d{7}[A-Z]$/.test(input)) return false;
  const prefixDigit = input[0] === 'X' ? '0' : input[0] === 'Y' ? '1' : '2';
  const number = Number(prefixDigit + input.slice(1, 8));
  const expected = DNI_NIE_LETTERS[number % 23];
  return expected === input[8];
}

/**
 * Belgian National Register Number (NRN / Rijksregisternummer).
 *
 * 11 digits. The first 6 encode YYMMDD; the next 3 a daily counter; the
 * last 2 a check (mod 97 of the first 9 digits, complemented).
 * Numbers issued in or after 2000 add 2_000_000_000 to the first 9 digits
 * before the mod-97. Both forms are accepted.
 */
export function beNrnCheck(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const base = Number(digits.slice(0, 9));
  const check = Number(digits.slice(9, 11));
  const expected20th = 97 - (base % 97);
  const expected21st = 97 - ((2_000_000_000 + base) % 97);
  return check === expected20th || check === expected21st;
}

/**
 * Australian Tax File Number (TFN) — 9 digits, weighted mod-11.
 */
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
 * New Zealand IRD number — 8 or 9 digits, weighted mod-11 with fallback
 * weight set. Implements the algorithm published by Inland Revenue.
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
 * Argentinian CUIL/CUIT — 11 digits, weighted mod-11.
 *
 * Weights: [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] over the first 10 digits.
 * The check digit equals `11 - (sum % 11)` mapped: 11 → 0, 10 → invalid.
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
 * Hong Kong HKID — `[A-Z]{1,2}\d{6}` + check char (digit or `A`).
 *
 * Letters map to 10..35; the alphabet position is multiplied by descending
 * weights 9..2 (plus a leading space contributing 36 when only one letter
 * is present). The check is `(sum mod 11)` → digit or `A` (for 10).
 */
export function hkHkidCheck(input: string): boolean {
  if (!/^[A-Z]{1,2}\d{6}[A0-9]$/.test(input)) return false;
  // Pad single-letter prefix with a leading space so weight 9 sees " ".
  const padded = input.length === 8 ? ' ' + input : input;
  const charValue = (c: string): number => {
    if (c === ' ') return 36;
    const code = c.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48; // 0-9
    if (code >= 65 && code <= 90) return code - 55; // A-Z = 10-35
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
 * Mexican CURP — 18 chars, last digit is a mod-10 check.
 *
 * Chars 0-16: weight = position desc (18..2), value table maps
 * letters A→10..Ñ→24..Z→35 and digits 0..9 as themselves. The check
 * digit equals `(10 - (sum mod 10)) mod 10`.
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
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(input[17]);
}

/**
 * German Steuerliche Identifikationsnummer (Steuer-ID / IdNr).
 *
 * 11 digits, leading digit is not 0. In the first 10 digits:
 *  - either exactly one digit appears twice and exactly one is missing, OR
 *  - exactly one digit appears three times and exactly two are missing.
 * The 11th digit is an ISO 7064 MOD 11,10 check.
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
  const expected = (11 - product) % 10;
  return expected === Number(digits[10]);
}

/**
 * Romanian CNP — 13-digit Cod Numeric Personal. Weights `[2,7,9,1,4,6,3,5,8,2,7,9]`
 * over the first 12 digits, mod 11; remainder 10 → check digit 1.
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
 * Turkish TC Kimlik No — 11 digits. Two cascading checks on positions
 * 1..9: 10th = ((odd-sum * 7) - even-sum) mod 10; 11th = sum(1..10) mod 10.
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
 * Swedish Personnummer / Samordningsnummer — 10 or 12 digits Luhn-style.
 *
 * Accept input as digits-only (10 or 12). For 12-digit (with century),
 * drop the century before applying the Luhn check on the trailing 10
 * digits.
 */
export function sePersonnummerCheck(digits: string): boolean {
  if (digits.length === 12) digits = digits.slice(2);
  if (!/^\d{10}$/.test(digits)) return false;
  return luhnCheck(digits);
}

/**
 * Israeli Teudat Zehut — 9 digits, Luhn-style with no leading-zero strip.
 *
 * Pad to 9 with leading zeros; each digit is multiplied by 1 or 2 by
 * alternating positions; if doubled value is >9, sum its digits; sum mod
 * 10 must be 0.
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

// -----------------------------------------------------------------------------
// Wave-1 additions — checksums consumed by Wave-4 locale JSONs.
// -----------------------------------------------------------------------------

/**
 * Brazilian CNPJ — 14 digits, two cascading mod-11 check digits.
 *
 * Body = first 12 digits. d13 weights [5,4,3,2,9,8,7,6,5,4,3,2]; d14
 * weights [6,5,4,3,2,9,8,7,6,5,4,3,2] (over body + d13). For each:
 * remainder = sum mod 11 -> check = remainder < 2 ? 0 : 11 - remainder.
 * Repeated-digit CNPJs (`11111111111111`) are rejected up front.
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
 * French NIR (Sécu) — 15 digits = 13 body + 2 check.
 *
 * `(97 - (body mod 97)) === check`. Corsican departments encode the
 * department code as `2A` or `2B` at positions 6-7 (1-indexed):
 * substitute `2A`->`19`, `2B`->`18` before the mod-97 step. The pattern is
 * normally digits-only but we defensively accept the lettered form.
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
  // JS Number stays exact for integers up to 2^53; a 13-digit body fits.
  const expected = 97 - (Number(body) % 97);
  return expected === check;
}

/**
 * Italian Codice Fiscale — 16 chars (15 body + 1 letter check).
 *
 * Odd positions (1-indexed: 1,3,5,...,15) use CF_ODD; even positions use
 * CF_EVEN. Sum the values, mod 26, map to a letter A..Z.
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
    // 1-indexed position: i+1. Odd positions use CF_ODD; even use CF_EVEN.
    const v = (i + 1) % 2 === 1 ? CF_ODD[c] : CF_EVEN[c];
    if (v === undefined) return false;
    sum += v;
  }
  const expected = String.fromCharCode(65 + (sum % 26));
  return expected === input[15];
}

/**
 * Japanese My Number (個人番号) — 12 digits.
 *
 * Body = first 11 digits. For position n counted from the RIGHT of the
 * body (n=1 -> body[10], i.e. least significant), the weight q_n is
 * `n + 1` for 1<=n<=6 else `n - 5`. Sum, mod 11; check = 0 if rem <= 1 else
 * `11 - rem`. Must equal digits[11].
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
 * Korean Resident Registration Number (주민등록번호) — 13 digits.
 *
 * Weights [2,3,4,5,6,7,8,9,2,3,4,5] over first 12 digits; check digit
 * = `(11 - (sum mod 11)) mod 10`.
 */
export function krRrnCheck(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] ?? 0);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

/**
 * Russian INN-12 — 12 digits with two check digits.
 *
 * d11 = (Sigma first10 * [7,2,4,10,3,5,9,4,6,8]) mod 11 mod 10.
 * d12 = (Sigma first11 * [3,7,2,4,10,3,5,9,4,6,8]) mod 11 mod 10.
 */
export function ruInn12Check(digits: string): boolean {
  if (!/^\d{12}$/.test(digits)) return false;
  const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += (digits.charCodeAt(i) - 48) * (w11[i] ?? 0);
  }
  const d11 = (sum % 11) % 10;
  if (d11 !== Number(digits[10])) return false;
  sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += (digits.charCodeAt(i) - 48) * (w12[i] ?? 0);
  }
  const d12 = (sum % 11) % 10;
  return d12 === Number(digits[11]);
}

/**
 * Portuguese NIF — 9 digits. Weights [9,8,7,6,5,4,3,2] over first 8 mod
 * 11; if remainder < 2 -> check 0 else `11 - remainder`.
 */
export function ptNifCheck(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const weights = [9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weightedDigitSum(digits, weights);
  const rem = sum % 11;
  const check = rem < 2 ? 0 : 11 - rem;
  return check === Number(digits[8]);
}

/**
 * Czech Rodné Číslo — 9 or 10 digits.
 *
 * - 9-digit (pre-1954): no check digit; accept on length.
 * - 10-digit: whole number mod 11 must equal 0. Historical exception:
 *   when the body-mod-11 was 10, the check digit was emitted as 0;
 *   accept that too.
 */
export function czRcCheck(digits: string): boolean {
  if (!/^\d{9,10}$/.test(digits)) return false;
  if (digits.length === 9) return true;
  // Use BigInt to avoid precision risk on a 10-digit integer.
  const BIG_11 = BigInt(11);
  const BIG_10 = BigInt(10);
  const BIG_0 = BigInt(0);
  const bn = BigInt(digits);
  if (bn % BIG_11 === BIG_0) return true;
  const body = bn / BIG_10;
  const check = Number(bn % BIG_10);
  const bodyMod = Number(body % BIG_11);
  return bodyMod === 10 && check === 0;
}

/**
 * Danish CPR — 10 digits. Strict mod-11 with weights [4,3,2,7,6,5,4,3,2,1].
 * Sum mod 11 must be 0. Post-2007 CPRs may fail this; callers that need
 * format-only matching should omit the checksum in their locale JSON.
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
 * Malaysian MyKad — 12 digits (YYMMDD-PB-NNNG). No formal checksum;
 * validate that the leading 6 digits form a plausible date (month 01-12,
 * day 01-31).
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
 * Singapore NRIC / FIN — 9 chars: `[STFGM]\d{7}[A-Z]`.
 *
 * Weights [2,7,6,5,4,3,2] over the 7 digits; for prefixes T, G, or M,
 * add 4 to the weighted sum (post-2000 correction). Take mod 11 and look
 * up the letter in the appropriate table. The 'M' prefix (foreign workers,
 * introduced 2022) uses the same weights and FIN lookup table as F/G.
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
