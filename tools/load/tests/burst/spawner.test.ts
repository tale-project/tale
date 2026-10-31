import { afterEach, describe, expect, test } from 'bun:test';

import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  parseAdmission,
  readAdmission,
  signSpawnerRequest,
  spawnerHeaders,
} from '../../src/burst/spawner.ts';
import { HttpClient, createAgent } from '../../src/client/index.ts';
import { MetricsRegistry } from '../../src/metrics/index.ts';
import { type TestServer, startServer } from '../client/test-server.ts';

/** An admission answer as the spawner sends it, `hold` for memory. */
function admissionBody(): Record<string, unknown> {
  return {
    verdict: 'hold',
    reason: 'memory',
    retryAfterMs: 5_000,
    preset: 'default',
    observedAtMs: 1_767_225_600_000,
    evidence: {
      pressure: { first: null, last: null, score: null, pressured: false },
      memory: {
        availableBytes: 1_500_000_000,
        reserveBytes: 1_717_986_918,
        totalBytes: 17_179_869_184,
      },
      disk: null,
      sessions: { running: 6, starting: 1, limit: 25 },
      leases: { active: 0, max: 2 },
    },
  };
}

describe('signSpawnerRequest', () => {
  test('signs the string the spawner verifies', () => {
    // The spawner's own `sign` (services/sandbox/src/auth.ts) gives this hex
    // for the same request: the two must not drift apart.
    expect(
      signSpawnerRequest({
        method: 'GET',
        path: '/v1/admission?organizationId=org_load-0&kind=start',
        timestamp: '1767225600000',
        nonce: 'nonce-0123456789abcdef',
        body: '',
        token: 'load-test-token',
      }),
    ).toBe('be2e6799de2e9cea35855b3cd2ed952946ffb3e3ea60bcbdb8b745221537e001');
  });

  test('upper-cases the method', () => {
    const request = {
      path: '/v1/admission',
      timestamp: '1',
      nonce: 'n',
      body: '',
      token: 't',
    };
    expect(signSpawnerRequest({ ...request, method: 'get' })).toBe(
      signSpawnerRequest({ ...request, method: 'GET' }),
    );
  });
});

describe('spawnerHeaders', () => {
  test('draws a fresh nonce for every request and signs with it', () => {
    const request = {
      method: 'GET',
      path: '/v1/admission',
      body: '',
      token: 't',
    };
    const first = spawnerHeaders(request, 1_000);
    const second = spawnerHeaders(request, 1_000);
    expect(first[TIMESTAMP_HEADER]).toBe('1000');
    expect(first[NONCE_HEADER]).not.toBe(second[NONCE_HEADER]);
    expect(first[SIGNATURE_HEADER]).toBe(
      signSpawnerRequest({
        ...request,
        timestamp: '1000',
        nonce: first[NONCE_HEADER] ?? '',
      }),
    );
  });
});

describe('parseAdmission', () => {
  test('keeps the verdict and the evidence the burst reads', () => {
    expect(parseAdmission(admissionBody())).toEqual({
      verdict: 'hold',
      reason: 'memory',
      observedAtMs: 1_767_225_600_000,
      memory: {
        availableBytes: 1_500_000_000,
        reserveBytes: 1_717_986_918,
        totalBytes: 17_179_869_184,
      },
      sessions: { running: 6, starting: 1, limit: 25 },
    });
  });

  test('keeps an answer whose host memory was unreadable', () => {
    const body = admissionBody();
    (body.evidence as Record<string, unknown>).memory = null;
    expect(parseAdmission(body)?.memory).toBeNull();
  });

  test('refuses what is not an admission answer', () => {
    expect(parseAdmission({ error: 'unauthorized' })).toBeNull();
    expect(parseAdmission({ ...admissionBody(), verdict: 'maybe' })).toBeNull();
    expect(parseAdmission(null)).toBeNull();
  });
});

describe('readAdmission', () => {
  let server: TestServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  function client(baseUrl: string): HttpClient {
    return new HttpClient({
      baseUrl,
      agent: createAgent(),
      metrics: new MetricsRegistry(),
    });
  }

  test('signs the path and query it sends, under a base path too', async () => {
    let signedOk = false;
    server = await startServer((request, response) => {
      const header = (name: string) => String(request.headers[name] ?? '');
      signedOk =
        header(SIGNATURE_HEADER) ===
        signSpawnerRequest({
          method: request.method,
          path: request.url,
          timestamp: header(TIMESTAMP_HEADER),
          nonce: header(NONCE_HEADER),
          body: request.body,
          token: 'secret-token',
        });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(admissionBody()));
    });
    const read = await readAdmission(
      client(`${server.url}/spawner/`),
      'secret-token',
      'org_load-0',
    );
    expect(server.requests[0]?.url).toBe(
      '/spawner/v1/admission?organizationId=org_load-0&kind=start',
    );
    expect(signedOk).toBe(true);
    expect(read.ok && read.sample.verdict).toBe('hold');
  });

  test('names a refusal and a body that is no answer', async () => {
    let status = 401;
    server = await startServer((_request, response) => {
      response.statusCode = status;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: 'unauthorized' }));
    });
    expect(await readAdmission(client(server.url), 't', 'org-1')).toEqual({
      ok: false,
      error: 'HTTP 401',
    });
    status = 200;
    expect(await readAdmission(client(server.url), 't', 'org-1')).toEqual({
      ok: false,
      error: 'not an admission answer',
    });
  });
});
