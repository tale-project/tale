export class TaskError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  readonly data: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}
