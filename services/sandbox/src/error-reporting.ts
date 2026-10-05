import * as Sentry from '@sentry/bun';

import {
  scrubEvent,
  scrubUrl,
} from '../../../packages/shared/src/monitoring/privacy.ts';
import { jsonResponse } from './http-util.ts';

let enabled = false;

/** Errors only. No request bodies, console breadcrumbs, sessions or tracing. */
export function initSandboxErrorReporting(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || enabled) return enabled;
  try {
    Sentry.init({
      dsn,
      release: process.env.TALE_VERSION,
      environment: process.env.SENTRY_ENVIRONMENT,
      defaultIntegrations: false,
      tracesSampleRate: 0,
      // The spawner intentionally survives unhandled promise rejections;
      // its existing backstop captures them. Uncaught exceptions still exit.
      integrations: [Sentry.onUncaughtExceptionIntegration()],
      skipOpenTelemetrySetup: true,
      sendDefaultPii: false,
      sendClientReports: false,
      enableLogs: false,
      tracePropagationTargets: [],
      beforeSend: scrubEvent,
      initialScope: { tags: { 'tale.role': 'sandbox' } },
    });
    enabled = true;
  } catch {
    console.warn('[sandbox] error reporting could not initialize');
  }
  return enabled;
}

/** A disconnect proves only its own abort/closed-stream error is expected. */
export function isClientDisconnect(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  if (!signal?.aborted) return false;
  if (error === signal.reason) return true;
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof TypeError &&
      error.message === 'Invalid state: Controller is already closed')
  );
}

export function reportSandboxError(
  error: unknown,
  operation: string,
  signal?: AbortSignal,
  request?: Request,
): void {
  if (!enabled || isClientDisconnect(error, signal)) return;
  Sentry.withScope((scope) => {
    scope.setTag('sandbox.operation', operation);
    if (request) {
      scope.setExtra('path', scrubUrl(request.url));
      scope.setExtra('method', request.method);
    }
    Sentry.captureException(error);
  });
}

export async function flushSandboxErrorReporting(): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(2000);
  } catch {
    console.warn('[sandbox] error reporting could not flush');
  }
}

/** Keep the HTTP failure outcome while reporting the failure once. */
export async function handleSandboxRequest(
  request: Request,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  try {
    return await handler(request);
  } catch (error) {
    if (isClientDisconnect(error, request.signal)) {
      return jsonResponse({ error: 'client_disconnected' }, 499);
    }
    reportSandboxError(error, 'http-handler', request.signal, request);
    console.error('[sandbox] handler error:', error);
    return jsonResponse({ error: 'internal', message: String(error) }, 500);
  }
}

export function sandboxServerError(error: Error): Response {
  reportSandboxError(error, 'http-server');
  console.error('[sandbox] server error:', error);
  return jsonResponse({ error: 'internal', message: String(error) }, 500);
}
