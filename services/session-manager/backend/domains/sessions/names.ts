// Session names: what is accepted, and the number a session gets when it is
// given none.

import { longerThan } from '../../../lib/secret-limits.ts';
import {
  SESSION_NAME_MAX_LENGTH,
  hasControlCharacter,
} from '../../../lib/session-name.ts';
import { casefold } from '../../lib/casefold.ts';
import { invalidName } from './refusals.ts';

/**
 * The name without the spaces around it. Throws the `invalid_name` refusal for
 * none, a long one, or one with a control character (a line break would split
 * it in a log, a NUL would end it in some places).
 */
export function validateName(raw: string): string {
  const name = raw.trim();
  if (
    name === '' ||
    longerThan(name, SESSION_NAME_MAX_LENGTH) ||
    hasControlCharacter(name)
  ) {
    throw invalidName();
  }
  return name;
}

/** The smallest "0001", "0002", ... ("10000" after "9999") that no session is named. */
export function nextAutoName(names: Iterable<string>): string {
  const taken = new Set(Array.from(names, casefold));
  for (let n = 1; ; n += 1) {
    const name = String(n).padStart(4, '0');
    if (!taken.has(casefold(name))) return name;
  }
}
