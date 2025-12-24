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

