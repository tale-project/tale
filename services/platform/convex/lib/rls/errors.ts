/**
 * RLS Error Types
 *
 * Every RLS refusal extends `ConvexError`, so a throw that escapes a public
 * function is an APPLICATION error to the Convex runtime (detected via the
 * `Symbol.for('ConvexError')` marker, which subclasses inherit): the client
 * receives the structured `data` (`{ code, message }`) instead of a redacted
 * "Server Error", and the UI can dispatch on `data.code` exactly as it does
 * for `requireOrgMembershipById`'s errors. Server-side `instanceof` catches
 * (approvals, sandbox, members, tasks, governance, …) keep working unchanged
 * — the hierarchy is the same, only the base class changed. (#3021)
 *
 * `message` stays the human sentence (`ConvexError` would stringify the data
 * into it) so server logs and error reporters keep reading naturally.
 */

import { ConvexError } from 'convex/values';

/** Wire payload of an RLS refusal — what a client reads off `error.data`. */
type RLSErrorData = { code: string; message: string };

/**
 * Base RLS error class
 */
export class RLSError extends ConvexError<RLSErrorData> {
  readonly code: string;

  constructor(message: string, code: string) {
    super({ code, message });
    this.name = 'RLSError';
    this.message = message;
    this.code = code;
  }
}

/**
 * Thrown when user is not authorized to access a resource.
 *
 * `code` defaults to `UNAUTHORIZED`; the membership check passes the sharper
 * `ORG_NOT_FOUND` (organization row gone) vs `ORG_FORBIDDEN` (organization
 * exists, caller is not a non-disabled member) so a deleted organization no
 * longer reads as a permissions bug.
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
