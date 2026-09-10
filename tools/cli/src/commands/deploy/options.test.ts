import { expect, test } from 'bun:test';

import { CliError } from '../../utils/fail';
import { assertManagedPlatform } from './options';

test('managed deployment requires POSIX custody without restricting config commands', () => {
  expect(() => assertManagedPlatform('linux')).not.toThrow();
  expect(() => assertManagedPlatform('darwin')).not.toThrow();
  try {
    assertManagedPlatform('win32');
    throw new Error('Windows managed deployment was admitted');
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ info: { code: 3 } });
    expect(String(error)).toContain('standalone config release commands');
  }
});
