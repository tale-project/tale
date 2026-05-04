import type { ChecksumCase } from './types';

/**
 * IBAN test fixtures. All `shouldMatch: true` entries verified to pass
 * `validator.isIBAN()` (Round 2 R2-10). Bad-checksum samples must be
 * rejected by the validate hook even though the regex shape matches.
 */
export const IBAN_CASES: ChecksumCase[] = [
  // Valid (mod-97 passes)
  { input: 'DE89 3704 0044 0532 0130 00', shouldMatch: true },
  { input: 'FR14 2004 1010 0505 0001 3M02 606', shouldMatch: true },
  { input: 'GB29 NWBK 6016 1331 9268 19', shouldMatch: true },
  { input: 'CH93 0076 2011 6238 5295 7', shouldMatch: true },
  { input: 'AT61 1904 3002 3457 3201', shouldMatch: true },
  { input: 'BE68 5390 0754 7034', shouldMatch: true },
  { input: 'LU28 0019 4006 4475 0000', shouldMatch: true },
  { input: 'LI94 0881 0000 2324 0137 0', shouldMatch: true },

  // Invalid (regex shape OK but checksum fails)
  {
    input: 'DE89 3704 0044 0532 0130 99',
    shouldMatch: false,
    note: 'last digits altered, checksum fails',
  },
  {
    input: 'XX99 1234 5678 9012 3456',
    shouldMatch: false,
    note: 'XX is not a valid country code',
  },
];

/**
 * Credit card fixtures (Round 2 R2-10 verified Luhn validity). The card
 * regex has been tightened to use lookarounds so that 19-digit Discover
 * inputs aren't truncated mid-match, but validator.isCreditCard only
 * accepts 13/15/16-digit PANs — 19-digit Discover is therefore an
 * accepted blind spot.
 */
export const CREDIT_CARD_CASES: ChecksumCase[] = [
  // Valid — pass Luhn AND validator.isCreditCard's BIN regex
  { input: '4111 1111 1111 1111', shouldMatch: true, note: 'Visa 16' },
  {
    input: '4111-1111-1111-1111',
    shouldMatch: true,
    note: 'Visa with hyphens',
  },
  { input: '5500 0000 0000 0004', shouldMatch: true, note: 'MasterCard' },
  { input: '3782 822463 10005', shouldMatch: true, note: 'Amex 15' },
  { input: '6011 1111 1111 1117', shouldMatch: true, note: 'Discover 16' },
  { input: '6759649826438453', shouldMatch: true, note: 'Maestro' },
  { input: '6250941006528599', shouldMatch: true, note: 'UnionPay' },
  { input: '4222222222222', shouldMatch: true, note: 'Visa 13' },

  // Invalid — Luhn fails (regex matches but validate rejects)
  {
    input: '1234 5678 9012 3456',
    shouldMatch: false,
    note: 'random 16 digits',
  },
  { input: '0000 0000 0000 0000', shouldMatch: false },
];
