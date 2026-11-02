// The Docker API proxy's allowlist, read from the nginx configuration the
// image ships, and its filter on inspect answers. The real nginx runs the
// same configuration in the container image test (.github/workflows).
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import strip from './strip-env.js';

const conf = readFileSync(join(import.meta.dir, 'nginx.conf'), 'utf8');

function mapBlock(variable: string): string {
  const start = conf.indexOf(`map ${variable} `);
  expect(start).toBeGreaterThan(-1);
  return conf.slice(start, conf.indexOf('}', start));
}

const methods = new Set(
  [...mapBlock('$request_method').matchAll(/^\s+([A-Z]+) 1;$/gm)].map(
    (m) => m[1],
  ),
);
const paths = [...mapBlock('$request_uri').matchAll(/^\s+"~(.+)" 1;$/gm)].map(
  (m) => new RegExp(m[1] ?? ''),
);

/** What the proxy answers: true when it forwards the request to the daemon. */
const allowed = (method: string, uri: string) =>
  methods.has(method) && paths.some((path) => path.test(uri));

describe('the Docker API allowlist', () => {
  it('answers the reads the Docker provider makes', () => {
    for (const [method, uri] of [
      ['GET', '/_ping'],
      ['HEAD', '/_ping'],
      ['GET', '/v1.47/version'],
      ['GET', '/v1.47/containers/json?all=1&filters=%7B%7D'],
      ['GET', `/v1.47/containers/${'a'.repeat(64)}/json`],
      ['GET', '/v1.47/containers/tale-platform-1/json'],
      [
        'GET',
        '/v1.47/events?filters=%7B%22type%22%3A%7B%22container%22%3Atrue%7D%7D',
      ],
    ] as const) {
      expect({ method, uri, allowed: allowed(method, uri) }).toEqual({
        method,
        uri,
        allowed: true,
      });
    }
  });

  it('refuses every write, whatever the path', () => {
    for (const method of [
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
      'CONNECT',
      'OPTIONS',
    ]) {
      expect(allowed(method, '/v1.47/containers/create')).toBe(false);
      expect(allowed(method, '/v1.47/containers/json')).toBe(false);
    }
  });

  it('refuses the endpoints it does not list', () => {
    for (const uri of [
      '/v1.47/images/json',
      '/v1.47/info',
      '/v1.47/networks',
      '/v1.47/volumes',
      '/v1.47/secrets',
      '/v1.47/containers/abc/logs',
      '/v1.47/containers/abc/archive?path=/',
      '/v1.47/containers/abc/export',
      '/v1.47/containers/abc/top',
      '/v1.47/exec/abc/json',
      '/v1.47/containers/../images/json',
      '/v1.47/containers/abc/json/../../../images/json',
      '/v1.47/containers/%2e%2e/json',
      '/containers/json/../create',
      '/v1.47/_ping/x',
    ]) {
      expect({ uri, allowed: allowed('GET', uri) }).toEqual({
        uri,
        allowed: false,
      });
    }
  });

  it('filters every inspect answer, with or without a version', () => {
    const inspect = conf.match(
      /location ~ (\S+) \{(?:(?!location)[\s\S])*?js_body_filter strip\.body/,
    );
    expect(inspect).not.toBeNull();
    const location = new RegExp(inspect?.[1] ?? '');
    expect(location.test('/v1.47/containers/abc/json')).toBe(true);
    expect(location.test('/containers/abc/json')).toBe(true);
    expect(location.test('/v1.47/containers/json')).toBe(false);
  });
});

function filter(chunks: string[]) {
  const sent: string[] = [];
  const errors: string[] = [];
  const headersOut: Record<string, string> = { 'Content-Length': '123' };
  const r = {
    headersOut,
    error: (text: string) => errors.push(text),
    sendBuffer: (data: string, options: { last: boolean }) => {
      expect(options.last).toBe(true);
      sent.push(data);
    },
  };
  strip.headers(r);
  chunks.forEach((chunk, i) => {
    strip.body(r, Buffer.from(chunk), { last: i === chunks.length - 1 });
  });
  return { sent, errors, headersOut };
}

describe('the inspect filter', () => {
  const answer = {
    Id: 'abc',
    State: { Running: true, Health: { Status: 'healthy' } },
    Config: {
      Env: ['BETTER_AUTH_SECRET=s3cret', 'DATABASE_URL=postgres://u:p@db/tale'],
      Labels: {
        'traefik.enable': 'true',
        'com.docker.compose.project': 'tale',
      },
    },
    NetworkSettings: {
      Networks: { tale_internal: { IPAddress: '172.18.0.4' } },
    },
  };

  it('drops Config.Env and keeps what Traefik reads', () => {
    const text = JSON.stringify(answer);
    const { sent, errors, headersOut } = filter([
      text.slice(0, 40),
      text.slice(40, 90),
      text.slice(90),
    ]);
    expect(errors).toEqual([]);
    expect(headersOut['Content-Length']).toBeUndefined();
    expect(sent).toHaveLength(1);
    const { Env: _env, ...config } = answer.Config;
    expect(JSON.parse(sent[0] ?? '')).toEqual({ ...answer, Config: config });
    expect(sent[0]).not.toContain('s3cret');
  });

  it('keeps a multi-byte character split across chunks', () => {
    const text = JSON.stringify({
      Config: { Env: ['A=b'], Labels: { name: 'Zürich' } },
    });
    const at = Buffer.from(text).indexOf(Buffer.from('ü')) + 1;
    const bytes = Buffer.from(text);
    const sent: string[] = [];
    const r = {
      headersOut: {},
      error: () => {},
      sendBuffer: (data: string) => sent.push(data),
    };
    strip.body(r, bytes.subarray(0, at), { last: false });
    strip.body(r, bytes.subarray(at), { last: true });
    expect(JSON.parse(sent[0] ?? '')).toEqual({
      Config: { Labels: { name: 'Zürich' } },
    });
  });

  it('passes nothing on when it cannot parse the answer', () => {
    const { sent, errors } = filter([
      '{"Config":{"Env":["SECRET=x"]',
      ' truncated',
    ]);
    expect(sent).toEqual(['']);
    expect(errors).toHaveLength(1);
  });
});
