// The debug lines of the backend: what is ignored on purpose (a malformed
// message, an input a page refused, an action that ended after its tool had
// answered). Off, unless `DEBUG` names `session-manager` or `*`, the way the
// `debug` package reads it. The one place that reads `DEBUG`.

const ASKED_FOR = /(^|,)(\*|session-manager)(,|$)/;

/** Does `DEBUG` ask for this app's debug lines? */
export function debugEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return ASKED_FOR.test(env.DEBUG ?? '');
}

/**
 * The logger of one area of the backend: `debugLog('mcp')('…')` prints
 * `[mcp] …`. `DEBUG` is read when a line is written, not when the module is
 * loaded, so a test can switch the lines on and off.
 */
export function debugLog(area: string): (message: string) => void {
  return (message) => {
    if (debugEnabled()) console.debug(`[${area}] ${message}`);
  };
}
