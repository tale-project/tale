/**
 * Shared Error Classes
 * Contains common error classes used across multiple modules
 */

/**
 * Base application error
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AppError';

    // Restore prototype chain for proper instanceof checks
    // This is needed for Node <16 and some transpilers
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public errors: string[],
  ) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500);
    this.name = 'ConfigurationError';
  }
}

/**
 * Rule converter error
 */
export class RuleFormatConverterError extends AppError {
  constructor(message: string, code = 'RULE_FORMAT_CONVERTER_ERROR') {
    super(message, code, 400);
    this.name = 'RuleFormatConverterError';
  }
}
