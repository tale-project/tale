/**
 * Mask any decrypted secret value that a connector or DB driver echoed into an
 * error string before it crosses back out into a thrown Error. For the sandbox
 * integration-dispatch path that Error propagates all the way into the
 * container, so an upstream 4xx body, a stringified auth header, or a SQL driver
 * that echoes the connection string would otherwise round-trip a credential
 * fragment out. Only masks values long enough to be a real secret (>=8 chars) to
 * avoid clobbering short, non-sensitive substrings.
 */
export function redactSecrets(
  text: string,
  secrets: Record<string, string | undefined>,
): string {
  let out = text;
  for (const value of Object.values(secrets)) {
    if (value && value.length >= 8) {
      out = out.split(value).join('[REDACTED]');
    }
  }
  return out;
}
