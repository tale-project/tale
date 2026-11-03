// What an error says, for a log line, a refusal or a session's `error`. Anything
// can be thrown in JavaScript, so none of these assume an `Error`.

/** Characters of the first line of an error that are kept. */
const FIRST_LINE_LENGTH = 300;

// Every line terminator of the Unicode standard, not just `\n`: a message from
// a child process or a page can end its lines with any of them.
const LINE_BREAK = /\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/;

/** The message of an error, or the text of whatever else was thrown. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `Name: message` of an error, or the text of whatever else was thrown. */
export function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

/**
 * The first line of an error, shortened: Playwright errors append a long call
 * log. An error with no message says its name. Shortened by characters, so an
 * emoji is never cut in two.
 */
export function firstLine(error: unknown): string {
  const text = errorText(error).trim();
  if (text === '') return error instanceof Error ? error.name : 'Error';
  const [line = ''] = text.split(LINE_BREAK);
  return Array.from(line).slice(0, FIRST_LINE_LENGTH).join('');
}
