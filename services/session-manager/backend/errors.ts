/**
 * An API error: HTTP status, a stable machine-readable code, a user-facing
 * message and extra fields for the client to act on (the session that holds a
 * proxy, the exit IP two sessions share). It is answered as
 * `{ error: <code>, message, ...extra }` (see `lib/api/schemas.ts`).
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  /** The JSON body this error is answered with. */
  toBody(): { error: string; message: string } & Record<string, unknown> {
    return { ...this.extra, error: this.code, message: this.message };
  }
}
