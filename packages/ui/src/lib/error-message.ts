/**
 * The words a thrown value carries for the person reading a failure toast,
 * or `undefined` when it carries none they should read.
 *
 * A plain `Error`'s message is the sentence its thrower wrote for display: a
 * host's `onSet` or a controller's `save()` throws a translated line. A
 * structured error is different. One carrying `data` (a backend refusal, such
 * as the platform's `AppError`) serializes its whole payload into `message`
 * for logs, so printing it put `{"code":…}` under a toast's title. An empty
 * message, and a thrown value that is not an `Error`, carry no words either.
 * A host that knows its error types reads them before it throws; this is the
 * package's own floor.
 */
export function readableErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof Error) || 'data' in error) return undefined;
  return error.message.length > 0 ? error.message : undefined;
}
