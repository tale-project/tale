import { describe, expect, it } from 'vitest';

import { monitoringConfig, monitoringJson } from './config';
import { redactSiteError } from './redact';

const valid = {
  dsn: 'https://public@errors.example/42',
  service: 'tale-web',
  release: '1.0.0',
};

describe('optional monitoring configuration', () => {
  it.each([
    undefined,
    null,
    {},
    { ...valid, dsn: '' },
    { ...valid, service: 1 },
    { ...valid, dsn: 'bad' },
    { ...valid, dsn: 'http://key@remote.example/1' },
    { ...valid, dsn: 'javascript:alert(1)' },
    { ...valid, dsn: 'https://key:secret@errors.example/1' },
    { ...valid, dsn: 'https://errors.example/1' },
    { ...valid, dsn: 'https://key@errors.example/no-project' },
    { ...valid, dsn: 'https://key@errors.example/1?secret=1' },
  ])('disables malformed or insecure configuration %j', (value) => {
    expect(monitoringConfig(value)).toBeUndefined();
  });

  it('allows only selected public metadata and explicit loopback test receivers', () => {
    expect(
      monitoringConfig({
        ...valid,
        environment: 'production',
        PRIVATE_TOKEN: 'never',
      }),
    ).toEqual({ ...valid, environment: 'production' });
    expect(
      monitoringConfig({ ...valid, dsn: 'http://key@127.0.0.1:4132/1' })?.dsn,
    ).toContain('127.0.0.1');
  });

  it('cannot close the inert script element or turn metadata into HTML', () => {
    const value = { ...valid, release: '</script><script>alert(1)</script>&' };
    const json = monitoringJson(value);
    expect(json).not.toContain('<');
    expect(json).not.toContain('&');
    expect(JSON.parse(json)).toEqual(value);
  });
});

describe('report data boundary', () => {
  it('keeps grouping locations, not form data or credentials', () => {
    const event = redactSiteError(
      {
        type: undefined,
        event_id: 'id',
        request: {
          url: 'https://site/contact?email=private',
          cookies: { session: 'private session' },
        },
        user: { email: 'private@example.test' },
        breadcrumbs: [{ message: 'private form' }],
        extra: { token: 'private token' },
        contexts: { visitor: { body: 'private body' } },
        tags: { email: 'private' },
        message: 'private',
        exception: {
          values: [
            {
              type: 'TypeError',
              value: 'private exception',
              stacktrace: {
                frames: [
                  {
                    filename:
                      'https://site/assets/contact-123.js?token=private',
                    function: 'submit',
                    lineno: 42,
                    colno: 1,
                    vars: { secret: 'private' },
                    context_line: 'private source',
                  },
                ],
              },
            },
          ],
        },
      },
      'tale-web',
      true,
    );
    expect(JSON.stringify(event)).not.toContain('private');
    expect(event.tags).toEqual({ service: 'tale-web' });
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: '/assets/contact-123.js',
      function: 'submit',
      lineno: 42,
      colno: 1,
      in_app: undefined,
    });
    expect(
      redactSiteError(
        {
          type: undefined,
          exception: {
            values: [
              {
                stacktrace: {
                  frames: [
                    { filename: '/private/app/server.js?token=private' },
                  ],
                },
              },
            ],
          },
        },
        'tale-docs',
        false,
      ).exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename,
    ).toBe('server.js');
  });
});
