import type { ErrorEvent } from '@sentry/browser';

/** Keep grouping metadata, never visitor data, request bodies or error text. */
export function redactSiteError(
  event: ErrorEvent,
  service: string,
  browser: boolean,
): ErrorEvent {
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    level: event.level,
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    sdk: event.sdk,
    tags: { service },
    exception: {
      values: event.exception?.values?.map((exception) => ({
        type: exception.type,
        value: 'Application error (details omitted)',
        stacktrace: {
          frames: exception.stacktrace?.frames?.map((frame) => ({
            filename: browser
              ? frame.filename?.match(/\/assets\/[\w.-]+\.js/)?.[0]
              : frame.filename?.split(/[\\/]/).pop()?.split(/[?#]/)[0],
            function: frame.function,
            lineno: frame.lineno,
            colno: frame.colno,
            in_app: frame.in_app,
          })),
        },
      })),
    },
  };
}
