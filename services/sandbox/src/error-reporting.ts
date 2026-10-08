import {
  scrubEvent,
  scrubUrl,
} from '../../../packages/shared/src/monitoring/privacy.ts';
import { jsonResponse } from './http-util.ts';

type SentrySdk = typeof import('@sentry/bun');

// The SDK is loaded only when a DSN asks for it: importing it holds 60-85 MiB
// resident, and most deployments and every connected device run without one.
// Until it is loaded, reporting and flushing do nothing.
let sentry: SentrySdk | null = null;
let initializing: Promise<boolean> | null = null;

/** Errors only. No request bodies, console breadcrumbs, sessions or tracing.
 * Await it before serving, so a failure from then on is reported. */
export function initSandboxErrorReporting(): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return Promise.resolve(sentry !== null);
  initializing ??= startErrorReporting(dsn);
  return initializing;
}

async function startErrorReporting(dsn: string): Promise<boolean> {
  try {
    const Sentry = await import('@sentry/bun');
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
    sentry = Sentry;
  } catch {
    console.warn('[sandbox] error reporting could not initialize');
  }
  return sentry !== null;
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
  const sdk = sentry;
  if (sdk === null || isClientDisconnect(error, signal)) return;
  sdk.withScope((scope) => {
    scope.setTag('sandbox.operation', operation);
    if (request) {
      scope.setExtra('path', scrubUrl(request.url));
      scope.setExtra('method', request.method);
    }
    sdk.captureException(error);
  });
}

export async function flushSandboxErrorReporting(): Promise<void> {
  if (sentry === null) return;
  try {
    await sentry.flush(2000);
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
