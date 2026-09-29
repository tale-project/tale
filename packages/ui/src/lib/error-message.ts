/** The error types the JavaScript runtime raises itself: a fault in the code
 * or in an answer (a property read on nothing, a body that is not JSON, an
 * invalid date), worded for its developer, never for the person. */
const RUNTIME_ERRORS = [
  TypeError,
  SyntaxError,
  RangeError,
  ReferenceError,
  EvalError,
  URIError,
];

/**
 * The words a thrown value carries for the person reading a failure toast,
 * or `undefined` when it carries none they should read.
 *
 * A plain `Error`'s message is the sentence its thrower wrote for display: a
 * host's `onSet` or a controller's `save()` throws a translated line. A
 * structured error is different. One carrying `data` (a backend refusal, such
 * as the platform's `AppError`) serializes its whole payload into `message`
 * for logs, so printing it put `{"code":…}` under a toast's title. A runtime
 * error carries no words either, and neither do an empty message and a thrown
 * value that is not an `Error`. A host that knows its error types reads them
 * before it throws; this is the package's own floor.
 *
 * The platform's `failureDetail` builds on this floor and adds what only the
 * platform can word: a refusal's own sentence, and a request that got no
 * answer (the browser's `TypeError: Failed to fetch`) as its localized
 * "couldn't reach Tale". Here that request is one more runtime error, so the
 * surface shows its own fallback.
 */
export function readableErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof Error) || 'data' in error) return undefined;
  if (RUNTIME_ERRORS.some((type) => error instanceof type)) return undefined;
  return error.message.length > 0 ? error.message : undefined;
}
