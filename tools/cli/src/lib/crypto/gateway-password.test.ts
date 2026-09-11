import { describe, expect, test } from 'bun:test';

import { generateGatewayAdminPassword } from './gateway-password';

describe('gateway bootstrap password policy', () => {
  test.each([
    ['uppercase only', 'A'.repeat(43)],
    ['lowercase only', 'g'.repeat(43)],
    ['digits only', '0'.repeat(43)],
    ['special characters and digit only', `${'_'.repeat(42)}8`],
    ['all classes already present', `${'Aa0-'.repeat(10)}Aa0`],
  ])(
    'completes missing classes without discarding entropy: %s',
    (_name, base) => {
      const bytes = Buffer.from(base, 'base64url');
      expect(bytes.length).toBe(32);
      expect(bytes.toString('base64url')).toBe(base);
      const password = generateGatewayAdminPassword((size) => {
        expect(size).toBe(32);
        return bytes;
      });
      expect(password.startsWith(base)).toBe(true);
      expect(password.length).toBeGreaterThanOrEqual(43);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
      expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
      if (
        [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].every((pattern) =>
          pattern.test(base),
        )
      ) {
        expect(password).toBe(base);
      }
    },
  );
});
