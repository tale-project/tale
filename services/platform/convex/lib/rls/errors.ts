/**
 * RLS Error Types
 */

/**
 * Base RLS error class
 */
export class RLSError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'RLSError';
  }
}

/**
 * Thrown when user is not authorized to access a resource
 */
export class UnauthorizedError extends RLSError {
  constructor(message = 'Not authorized to access this resource') {
    super(message, 'UNAUTHORIZED');
  }
}

/**
 * Thrown when user is not authenticated
 */
export class UnauthenticatedError extends RLSError {
  constructor(message = 'Authentication required') {
    super(message, 'UNAUTHENTICATED');
  }
}

/**
 * Thrown when resource belongs to a different organization
 */
export class OrganizationMismatchError extends RLSError {
  constructor(message = 'Resource belongs to a different organization') {
    super(message, 'ORGANIZATION_MISMATCH');
  }
}

