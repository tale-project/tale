import type { PhoneCase } from './types';

/**
 * International phone numbers handled by libphonenumber-js's
 * `findPhoneNumbersInText`. Avoid NANP 555 fictional area codes (R1-18 found
 * libphonenumber rejects most 555 numbers as `isValid: false`); use real
 * test ranges (415, 212, etc.) instead.
 */
export const PHONES_INTL: PhoneCase[] = [
  { input: '+49 30 12345678', expectedMatches: ['+49 30 12345678'] },
  { input: '+49 (30) 1234-5678', expectedMatches: ['+49 (30) 1234-5678'] },
  { input: '+33 1 42 86 82 00', expectedMatches: ['+33 1 42 86 82 00'] },
  { input: '+33 6 12 34 56 78', expectedMatches: ['+33 6 12 34 56 78'] },
  { input: '+44 20 7946 0958', expectedMatches: ['+44 20 7946 0958'] },
  { input: '+1 (415) 555-2671', expectedMatches: ['+1 (415) 555-2671'] },
  { input: '+41 44 668 18 00', expectedMatches: ['+41 44 668 18 00'] },
  {
    input: 'Call me at +49 30 12345678 today',
    expectedMatches: ['+49 30 12345678'],
  },
];

/**
 * Local-format numbers reached only via the context-anchored regex. The
 * detector returns just the captured number (keyword stays unmasked).
 *
 * Negative cases: bare local numbers without context, error codes, room
 * numbers — all should produce zero matches.
 */
export const PHONES_LOCAL_WITH_CONTEXT: PhoneCase[] = [
  // German keywords
  { input: 'Tel: 030 12345678', expectedMatches: ['030 12345678'] },
  { input: 'Telefon: 030 12345678', expectedMatches: ['030 12345678'] },
  { input: 'Mein Handy: 0151 12345678', expectedMatches: ['0151 12345678'] },
  // French keywords
  { input: 'Tél: 01 42 86 82 00', expectedMatches: ['01 42 86 82 00'] },
  { input: 'Téléphone: 06 12 34 56 78', expectedMatches: ['06 12 34 56 78'] },
  { input: 'Portable 06.12.34.56.78', expectedMatches: ['06.12.34.56.78'] },
  // Swiss-specific keyword
  { input: 'Natel: 079 123 45 67', expectedMatches: ['079 123 45 67'] },
  // English keywords
  { input: 'Phone: (415) 123-4567', expectedMatches: ['(415) 123-4567'] },
  { input: 'Cell: 415-123-4567', expectedMatches: ['415-123-4567'] },
];

export const PHONES_NEGATIVES: PhoneCase[] = [
  // Bare locals (no context, no `+`) — intentional non-detection
  { input: '030 12345678', expectedMatches: [] },
  { input: '(415) 123-4567', expectedMatches: [] },
  // Definite non-phones
  { input: 'error code 1234567890', expectedMatches: [] },
  { input: 'pi is approximately 3.14159265', expectedMatches: [] },
  { input: 'the year was 1987', expectedMatches: [] },
  { input: 'room 12345', expectedMatches: [] },
  { input: 'cell biology is fascinating', expectedMatches: [] },
  { input: 'phone home tonight', expectedMatches: [], note: 'no number' },
];
