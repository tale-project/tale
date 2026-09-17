import { usageError } from '../../utils/fail';
import { readPrivateText } from '../../utils/private-input';
import {
  hashAccountPassword,
  passwordPolicyFailures,
} from '../crypto/password-hash';

/** Better Auth's default maximum password length, in characters. */
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_INPUT_LIMIT = 4096;

/** One password from a non-terminal stream. Only the single line ending that
 * `echo` or a heredoc appends is removed; a password that could never be
 * typed at sign-in (control characters) is refused. */
export async function readPasswordInput(
  source: AsyncIterable<unknown>,
): Promise<string> {
  const text = await readPrivateText(source, PASSWORD_INPUT_LIMIT, {
    invalid: 'Invalid password input stream.',
    oversized: 'The password input exceeds 4 KiB.',
    unreadable: 'Unable to read the password from stdin.',
    encoding: 'The password is not valid UTF-8.',
  });
  return checkedPassword(text.replace(/\r?\n(?![\s\S])/, ''));
}

function checkedPassword(password: string): string {
  if (!password) throw usageError('No password was provided.');
  if (/[\x00-\x1f\x7f]/.test(password))
    throw usageError('The password contains control characters.');
  if (password.length > PASSWORD_MAX_LENGTH)
    throw usageError(`The password exceeds ${PASSWORD_MAX_LENGTH} characters.`);
  return password;
}

/** The Better Auth credential hash of a password that meets the platform's
 * default password policy. The plaintext is neither returned nor echoed. */
export async function hashPolicyPassword(password: string): Promise<string> {
  const failures = passwordPolicyFailures(checkedPassword(password));
  // Summary only: the failure renderer prints hints on stdout, which carries
  // nothing but the hash.
  if (failures.length)
    throw usageError(
      `The password does not meet the platform's default password policy (failed: ${failures.join(', ')}); use at least 12 characters with upper- and lowercase letters, a digit and one of !@#$%^&*(),.?":{}|<>`,
    );
  return hashAccountPassword(password);
}
