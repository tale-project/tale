import * as Sentry from '@sentry/node';
import type { MiddlewareHandler } from 'hono';

import { TASK_QUEUE_OPTIONS } from './jobs/tasks.ts';
import {
  httpDuration,
  httpRequests,
  methodClass,
  routeClass,
} from './telemetry.ts';

let enabled = false;

/** Called only after the error-reporting SDK initialized successfully. */
export function configureBackendTracing(value: boolean): void {
  enabled = value;
}

type SpanCallback<T> = (span?: Sentry.Span) => T;
type WorkerPhase = 'check_drain' | 'handover' | 'handler';

/** No SDK scope or promise allocation on the default, disabled path. */
function traceRoot<T>(op: string, name: string, run: SpanCallback<T>): T {
  if (!enabled) return run();
  // Never inherit sampling or parentage from caller-controlled trace headers,
  // nor from the queue poll that delivered a batch of unrelated jobs.
  return Sentry.withIsolationScope(() =>
    Sentry.startNewTrace(() => Sentry.startSpan({ op, name }, run)),
  );
}

/** Queue names come from the registry; job ids and payloads never enter spans. */
export function traceBackendTask<T>(task: string, run: SpanCallback<T>): T {
  const name = Object.hasOwn(TASK_QUEUE_OPTIONS, task) ? task : 'other';
  return traceRoot('queue.process', name, run);
}

/** A bounded child of a task; includes database wait in the phase that owns it. */
export function traceWorkerPhase<T>(phase: WorkerPhase, run: () => T): T {
  if (!enabled) return run();
  return Sentry.startSpan({ op: `queue.${phase}`, name: phase }, run);
}

/** Measures handler completion, not the lifetime of a streamed response body. */
export function requestTelemetry(): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    const route = routeClass(c.req.path);
    const method = methodClass(c.req.method);
    await traceRoot('http.server', `${method} ${route}`, async (span) => {
      try {
        await next();
      } finally {
        const seconds = (performance.now() - started) / 1000;
        httpDuration.observe({ method, route }, seconds);
        httpRequests.inc({
          method,
          route,
          status: `${Math.floor(c.res.status / 100)}xx`,
        });
        if (span !== undefined) {
          span.setAttribute('http.request.method', method);
          span.setAttribute('http.route', route);
          Sentry.setHttpStatus(span, c.res.status);
        }
      }
    });
  };
}

type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type TransactionEvent = Parameters<
  NonNullable<InitOptions['beforeSendTransaction']>
>[0];

const SPAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'sentry.op',
  'sentry.origin',
  'sentry.source',
  'sentry.sample_rate',
  'http.request.method',
  'http.route',
  'http.response.status_code',
]);

function operationalAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (
      SPAN_ATTRIBUTES.has(key) &&
      (typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean')
    ) {
      result[key] = value;
    }
  }
  return result;
}

/** Transaction hooks are separate from beforeSend. Inherited request data,
 * breadcrumbs, job extras and user context must not ride a manual timing span.
 * Automatic SQL/HTTP instrumentation is disabled at SDK initialization. */
export function scrubTransaction(event: TransactionEvent): TransactionEvent {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  const trace = event.contexts?.trace;
  if (trace !== undefined) trace.data = operationalAttributes(trace.data);
  event.contexts = trace === undefined ? {} : { trace };
  event.tags =
    event.tags?.['tale.role'] === undefined
      ? {}
      : { 'tale.role': event.tags['tale.role'] };
  for (const span of event.spans ?? []) {
    span.data = operationalAttributes(span.data);
  }
  return event;
}
