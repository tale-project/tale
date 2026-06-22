import fs from 'node:fs';
import path from 'node:path';

import { transform } from 'sucrase';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeIntegrationImpl } from './execute_integration_impl';

// Load and transpile the real shipped connector, exactly as the sandbox does.
const connectorCode = transform(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../../builtin-configs/integrations/github/connector.ts',
    ),
    'utf-8',
  ),
  { transforms: ['typescript'], disableESTransforms: true },
).code;

const SECRETS = { accessToken: 'tok' };
const ALLOWED = ['api.github.com'];

// Feed the sandbox a fixed sequence of HTTP responses and record requested URLs.
function seqFetch(responses: Array<() => Response>): string[] {
  let i = 0;
  const calls: string[] = [];
  globalThis.fetch = Object.assign(
    vi.fn().mockImplementation((url: string) => {
      calls.push(url);
      const factory = responses[i++];
      if (!factory) throw new Error('Unexpected fetch: ' + url);
      return Promise.resolve(factory());
    }),
    { preconnect: vi.fn() },
  );
  return calls;
}

function json(data: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

describe('GitHub connector', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Regression: mergeTaskPullRequest scopes the PR lookup to the task's
  // deterministic branch with `head: <owner>:tale/<id>`. The connector used to
  // drop `head` (and `base`) from the query string, so GitHub returned EVERY
  // open PR in the repo — the merge action then saw >1 and refused to merge.
  // The filter must reach the GitHub API.
  it('list_pull_requests forwards the head and base branch filters to the API URL', async () => {
    const calls = seqFetch([json([{ number: 7, state: 'open' }])]);

    const out = await executeIntegrationImpl({
      code: connectorCode,
      operation: 'list_pull_requests',
      params: {
        owner: 'octocat',
        repo: 'hello',
        head: 'octocat:tale/abc123',
        base: 'main',
        state: 'all',
        per_page: 20,
      },
      variables: {},
      secrets: SECRETS,
      allowedHosts: ALLOWED,
      timeoutMs: 5000,
    });

    expect(out.success).toBe(true);
    expect(calls).toHaveLength(1);
    const query = decodeURIComponent(calls[0].split('?')[1] ?? '');
    expect(query).toContain('head=octocat:tale/abc123');
    expect(query).toContain('base=main');
    expect(query).toContain('state=all');
  });
});
