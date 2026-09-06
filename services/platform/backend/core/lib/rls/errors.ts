/**
 * RLS Error Types
 *
 * Every RLS error extends `AppError`, so an uncaught throw reaches the
 * client as structured `{ code, message }` data it can dispatch on (the
 * stale-org recovery keys off `code === 'ORG_NOT_FOUND'`) instead of an
 * opaque redacted "Server Error" that clients blindly retry — part of the
 * codebase-wide "throw AppError codes" migration (`auth/membership.ts` and
 * `auth/org.ts` are the reference).
 *
 * Server-side semantics are unchanged: class identity is preserved, so the
 * many `error instanceof UnauthorizedError` degrade-gracefully catch sites
 * (approvals, sandbox, members, team_members, erasure, …) keep working, and
 * `message` is reassigned to the human sentence after `super()` so server
 * logs stay readable (the wire format serializes `data`, never `message`).
 */

import { AppError } from '../../../../lib/shared/errors/app-error';

/**
 * Base RLS error class
 */
export class RLSError extends AppError<{ code: string; message: string }> {
  constructor(
    message: string,
    public code: string,
  ) {
    super({ code, message });
    this.name = 'RLSError';
    this.message = message;
  }
}

/**
 * Thrown when user is not authorized to access a resource.
 *
 * `code` defaults to the generic `UNAUTHORIZED`; org-membership gates pass
 * `ORG_FORBIDDEN` / `ORG_NOT_FOUND` so clients can tell "you lack access"
 * apart from "this organization is gone" (stale persisted active org).
 */
export class UnauthorizedError extends RLSError {
  constructor(
    message = 'Not authorized to access this resource',
    code = 'UNAUTHORIZED',
  ) {
    super(message, code);
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
