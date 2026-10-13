// @vitest-environment node

/**
 * The challenge the MCP endpoint refuses with when coding agents may sign in
 * [AGCONN-R14]: where its metadata is, which scopes to ask for, and why a
 * credential that was presented is refused — in a form no caller can break.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mcpChallenge } from './agent-challenge.ts';

const SCOPES =
  'tale:mcp tale:automations.write tale:automations.deploy tale:settings.read tale:settings.write tale:subscriptions.connect offline_access';

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://tale.example.test');
  vi.stubEnv('ADDITIONAL_SITE_URLS', 'https://tale-b.example.test');
  vi.stubEnv('BASE_PATH', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const request = (url = 'https://tale.example.test/api/v1/mcp', host?: string) =>
  new Request(url, host === undefined ? {} : { headers: { host } });

describe('the challenge of the MCP endpoint [AGCONN-R14]', () => {
  it('tells a caller with nothing where the endpoint’s metadata is and every scope to ask for', () => {
    expect(mcpChallenge(request())).toBe(
      `Bearer resource_metadata="https://tale.example.test/.well-known/oauth-protected-resource/api/v1/mcp", scope="${SCOPES}"`,
    );
  });

  it('names the address the caller arrived on, when the deployment answers on it', () => {
    expect(
      mcpChallenge(
        request(
          'https://tale-b.example.test/api/v1/mcp',
          'tale-b.example.test',
        ),
      ),
    ).toContain(
      'resource_metadata="https://tale-b.example.test/.well-known/oauth-protected-resource/api/v1/mcp"',
    );
    // An address the deployment does not answer on is never echoed.
    expect(
      mcpChallenge(
        request('https://evil.example.test/api/v1/mcp', 'evil.example.test'),
      ),
    ).toContain('resource_metadata="https://tale.example.test/');
  });

  it('keeps a deployment’s base path in the address', () => {
    vi.stubEnv('BASE_PATH', '/tale/');
    expect(mcpChallenge(request())).toContain(
      'resource_metadata="https://tale.example.test/.well-known/oauth-protected-resource/tale/api/v1/mcp"',
    );
  });

  it('says why a credential that was presented is refused, before where to sign in', () => {
    expect(
      mcpChallenge(request(), {
        error: 'invalid_token',
        description: 'The access token has expired',
      }),
    ).toBe(
      `Bearer error="invalid_token", error_description="The access token has expired", resource_metadata="https://tale.example.test/.well-known/oauth-protected-resource/api/v1/mcp", scope="${SCOPES}"`,
    );
  });

  it('asks for the scopes it is given, when they are not every scope', () => {
    expect(
      mcpChallenge(request(), {
        error: 'insufficient_scope',
        scope: ['tale:mcp', 'tale:automations.write'],
      }),
    ).toContain('scope="tale:mcp tale:automations.write"');
  });

  it('lets nothing a caller chose break out of a quoted parameter', () => {
    const header = mcpChallenge(request(), {
      error: 'invalid_token',
      description: 'say "hi", \\ and\r\nSet-Cookie: x=y — ünï',
    });
    expect(header).toContain(
      'error_description="say hi,  andSet-Cookie: x=y  n"',
    );
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/"/g)?.length).toBe(8);
  });
});
