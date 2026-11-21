/**
 * The error-reporting SDK, loaded only by a deployment that asks for it.
 *
 * `@sentry/node` brings OpenTelemetry with it: about 550 modules and two
 * megabytes of source, which every backend process used to load at boot
 * whether or not a `SENTRY_DSN` was set (tale-project/tale#4942, finding 2).
 * `error-reporting.ts` loads it here when it initializes with a DSN; without
 * one the SDK is never read, and every caller's disabled path sees `null`.
 *
 * The handle lives in this module, apart from `error-reporting.ts`, because
 * `tracing.ts` needs it too and the two already import each other one way.
 */

import type * as Sentry from '@sentry/node';

export type SentrySdk = typeof Sentry;

let sdk: SentrySdk | null = null;

/** Load the SDK, once. Only for a process that has a DSN to report to. */
export async function loadSentrySdk(): Promise<SentrySdk> {
  sdk ??= await import('@sentry/node');
  return sdk;
}

/** The SDK once it has been loaded; null in a process that reports nothing. */
export function sentrySdk(): SentrySdk | null {
  return sdk;
}
