// @vitest-environment node
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { appErrorHandler } from '@/backend/error-reporting';

import {
  BackendApiError,
  backendApiErrorFromBody,
  readBackendApiError,
} from './api-client';
import { isPlatformUnavailable } from './platform-unavailable';

/** The edge's envelope as `services/proxy/Caddyfile` writes it for a machine
 * door while the platform does not answer, with the status of the error it
 * stands for. */
const EDGE_UNAVAILABLE = {
  error:
    'The platform is not answering right now — a deployment may be rolling; retry with backoff',
  code: 'UPSTREAM_UNAVAILABLE',
  requestId: '9d607850-ceb6-4990-b1e8-2e8d27199ffd',
};

/** What a real app door answers while its database restarts. */
async function databaseRestartAnswer(): Promise<Response> {
  const app = new Hono();
  app.onError(appErrorHandler);
  app.get('/api/app/tasks', () => {
    throw Object.assign(new Error('terminating connection'), {
      code: '57P01',
    });
  });
  return app.request('http://localhost/api/app/tasks');
}

describe('isPlatformUnavailable', () => {
  it.each([502, 503, 504])(
    "reads the edge's %i while the platform does not answer",
    (status) => {
      expect(
        isPlatformUnavailable(
          backendApiErrorFromBody(status, EDGE_UNAVAILABLE),
        ),
      ).toBe(true);
    },
  );

  it("reads the platform's own answer while its database restarts", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const error = await readBackendApiError(await databaseRestartAnswer());
      expect(error.status).toBe(503);
      expect(error.code).toBe('DATABASE_UNAVAILABLE');
      expect(isPlatformUnavailable(error)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([502, 503, 504])('reads an unstructured gateway %i', (status) => {
    expect(isPlatformUnavailable(backendApiErrorFromBody(status, null))).toBe(
      true,
    );
  });

  it('is false for every other failure', () => {
    // The backend's own fault: a text 500 the app reads by status alone.
    expect(
      isPlatformUnavailable(
        backendApiErrorFromBody(500, 'Internal Server Error'),
      ),
    ).toBe(false);
    // A dependency the platform answers for, not the platform itself.
    expect(
      isPlatformUnavailable(
        new BackendApiError(
          503,
          'Object store unavailable',
          'OBJECT_STORE_UNAVAILABLE',
        ),
      ),
    ).toBe(false);
    // Either code at a status it never comes with.
    expect(
      isPlatformUnavailable(
        new BackendApiError(
          500,
          'Database unavailable',
          'DATABASE_UNAVAILABLE',
        ),
      ),
    ).toBe(false);
    expect(
      isPlatformUnavailable(
        new BackendApiError(
          400,
          'Upstream unavailable',
          'UPSTREAM_UNAVAILABLE',
        ),
      ),
    ).toBe(false);
    // Not a backend answer at all.
    expect(isPlatformUnavailable(new Error(EDGE_UNAVAILABLE.error))).toBe(
      false,
    );
    expect(isPlatformUnavailable(undefined)).toBe(false);
  });
});
