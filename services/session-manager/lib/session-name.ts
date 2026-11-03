// The longest name a session can have. The server refuses more
// (`backend/domains/sessions/names.ts`) and the dialogs that name a session
// check it first: one definition, which both import.

export const SESSION_NAME_MAX_LENGTH = 80;

/**
 * How many characters a name has, as a person counts them: an emoji is one
 * character, not the two UTF-16 units it takes up in a string.
 */
export function nameLength(name: string): number {
  return Array.from(name).length;
}

/**
 * Whether a name has a character that is no part of a name: the controls of
 * C0 (NUL, tab, line breaks, escape), DEL, those of C1 (such as a next line)
 * and the line and paragraph separators. They break a line of a log, an
 * answer to an assistant and the lists of a page. The blanks around a name
 * are trimmed before this is asked; a no-break space is a space and stays.
 */
export function hasControlCharacter(name: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(name);
}
