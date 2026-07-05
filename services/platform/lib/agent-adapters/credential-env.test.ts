import { describe, expect, it } from 'vitest';

import {
  collectScrubCredentialEnvKeys,
  filterUserEnvForManagedAgentEnv,
} from './credential-env';

describe('filterUserEnvForManagedAgentEnv', () => {
  it('drops protected keys from the user patch', () => {
    expect(
      filterUserEnvForManagedAgentEnv({ CURSOR_API_KEY: 'user', FOO: 'bar' }, [
        'CURSOR_API_KEY',
      ]),
    ).toEqual({ FOO: 'bar' });
  });
});

describe('collectScrubCredentialEnvKeys', () => {
  it('scrubs other runtime keys and gateway keys for cursor managed', () => {
    const keys = collectScrubCredentialEnvKeys('cursor', false, false);
    expect(keys).toContain('ANTHROPIC_AUTH_TOKEN');
    expect(keys).toContain('ANTHROPIC_BASE_URL');
    expect(keys).not.toContain('CURSOR_API_KEY');
  });

  it('keeps cursor key off scrub list for cursor turns', () => {
    const keys = collectScrubCredentialEnvKeys('cursor', false, false);
    expect(keys).not.toContain('CURSOR_API_KEY');
  });
});
