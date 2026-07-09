import { describe, expect, it } from 'vitest';

import {
  DOCS_URL,
  GET_STARTED_URL,
  SELF_HOSTED_QUICKSTART_URL,
} from './docs-url';

describe('docs-url', () => {
  it('points Get started at the Start-tab quickstart, not self-hosted install', () => {
    expect(GET_STARTED_URL).toBe(`${DOCS_URL}/get-started/quickstart`);
    expect(GET_STARTED_URL).not.toContain('self-hosted/install');
  });

  it('points the homepage terminal at the self-hosted install quickstart', () => {
    expect(SELF_HOSTED_QUICKSTART_URL).toBe(
      `${DOCS_URL}/self-hosted/install/quickstart`,
    );
  });
});
