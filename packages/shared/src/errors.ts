/**
 * Base error classes for Tale services.
 */

export class TaleError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TaleError';
  }
}

export class ConfigError extends TaleError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export class ExtractionError extends TaleError {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExtractionError';
  }
}
