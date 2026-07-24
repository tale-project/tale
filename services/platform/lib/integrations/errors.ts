/**
 * The integration layer's issue-code catalog — one place naming every refusal
 * the dispatcher and the live host can raise, and the invariant each protects.
 *
 * Mirrors the engine's error discipline: a code is typo-safe, the message is
 * public API that agents and connector authors read behaviorally, and a hint
 * says what to do next. A caller can branch on `code` without parsing prose,
 * and a security refusal is never indistinguishable from a vendor 500.
 */

/** Every code the integration layer can emit, with the invariant it guards. */
export const INTEGRATION_CODES = {
  // Resolution.
  ORGANIZATION_REQUIRED: 'every invocation is scoped to one organization',
  CATALOG_UNAVAILABLE:
    'the connector catalog must be installed before dispatch',
  UNKNOWN_CONNECTOR: 'a connector name must exist in the shipped catalog',
  UNKNOWN_ACTION: 'an action must be declared by its connector',
  INPUT_INVALID: 'action input must match the action JSON Schema',

  // Live backends.
  NO_LIVE_BACKEND: 'a mock-only action cannot run live',
  NATIVE_IMPL_UNAVAILABLE:
    'a native backend must be registered before it can run',
  LIVE_RUNNER_UNAVAILABLE:
    'a live yaml-js body needs a host-capable code runner, never the data-only one',
  MOCK_BODY_FAILED: 'a deterministic mock body must produce its output',
  LIVE_BODY_FAILED:
    'a live connector body reached the outside world and failed',

  // Credentials and caller policy.
  CALLER_UNKNOWN: 'a caller is one of the declared modes, each with a policy',
  CREDENTIAL_RESOLVER_MISSING:
    'live execution needs an injected credential resolver',
  CREDENTIAL_UNRESOLVED: 'a live call needs a usable credential for the org',
  SYSTEM_REASON_REQUIRED:
    'a system-caller invocation states why it runs without approval',
  AUDIT_SINK_MISSING: 'a system-caller invocation must be recordable',
  AUDIT_FAILED: 'a system-caller invocation must actually be recorded',
  APPROVAL_GATE_MISSING: 'a user-initiated write must be gate-able',

  // Host mediation (the SSRF posture a connector body must not opt out of).
  INVALID_URL: 'a live request URL must parse',
  INSECURE_SCHEME: 'live integration traffic is https only',
  HOST_NOT_ALLOWED: "a live request must target the connector's allowed hosts",
  BLOCKED_HOST:
    'private, link-local, and cloud-metadata addresses are never reachable',
  REQUEST_FAILED: 'a live request that never produced a response is an error',
  RESPONSE_TOO_LARGE: 'a response body must fit the per-request cap',
} as const;

export type IntegrationErrorCode = keyof typeof INTEGRATION_CODES;

export interface IntegrationErrorExtras {
  connector?: string;
  action?: string;
  /** What the caller should do next — the catalog's teaching half. */
  hint?: string;
  cause?: unknown;
}

/**
 * One coded failure. Carries the connector/action it happened under so a log
 * line or a chat surface can name the capability without the caller
 * re-assembling context.
 */
export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly connector?: string;
  readonly action?: string;
  readonly hint?: string;

  constructor(
    code: IntegrationErrorCode,
    message: string,
    extras: IntegrationErrorExtras = {},
  ) {
    super(
      message,
      extras.cause === undefined ? undefined : { cause: extras.cause },
    );
    this.name = 'IntegrationError';
    this.code = code;
    this.connector = extras.connector;
    this.action = extras.action;
    this.hint = extras.hint;
  }

  /** Render as one line: what failed, where, and what to do. */
  describe(): string {
    const where =
      this.connector && this.action
        ? ` (${this.connector}.${this.action})`
        : this.connector
          ? ` (${this.connector})`
          : '';
    return `[${this.code}]${where} ${this.message}${this.hint ? ` — ${this.hint}` : ''}`;
  }
}
