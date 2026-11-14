export class BrandingError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;
  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'BrandingError';
    this.code = code;
    this.status = status;
  }
}
