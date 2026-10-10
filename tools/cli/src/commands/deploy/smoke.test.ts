import { describe, expect, test } from 'bun:test';

import { CliError, ExitCode } from '../../utils/fail';
import { createSmokeCommand, smokeCredentials } from './smoke';

describe('deploy smoke', () => {
  test('reads the smoke account from the environment only', () => {
    expect(
      smokeCredentials({
        TALE_SMOKE_EMAIL: ' smoke@example.com ',
        TALE_SMOKE_PASSWORD: 'secret value',
      }),
    ).toEqual({ email: 'smoke@example.com', password: 'secret value' });
    for (const env of [
      {},
      { TALE_SMOKE_EMAIL: 'smoke@example.com' },
      { TALE_SMOKE_PASSWORD: 'secret value' },
      { TALE_SMOKE_EMAIL: '  ', TALE_SMOKE_PASSWORD: 'secret value' },
    ]) {
      let error: unknown;
      try {
        smokeCredentials(env);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).info.code).toBe(ExitCode.Usage);
    }
  });

  test('takes no credential flags', () => {
    const flags = createSmokeCommand().options.map((option) => option.long);
    expect(flags).toEqual([
      '--url',
      '--expected-version',
      '--full',
      '--chat',
      '--organization',
      '--project',
      '--timeout',
      '--turn-timeout',
    ]);
  });
});
