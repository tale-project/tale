/**
 * Whether the auth client replays a request that failed: a 5xx or an
 * unreachable backend, yes (a cold start or a database restart is over in
 * seconds, and the session fetches latch their first answer); a 4xx, no; and
 * the server's own refusal of a password check, no either. That refusal
 * (`PASSWORD_CHECK_BUSY`, a 503 with a `Retry-After`) is the server shedding a
 * wave of sign-ins: four replays 0.5 to 4 seconds on would put five requests
 * from every browser into the queue it is protecting, long before the wait it
 * asked for. The person is told to try again in a moment instead.
 */
export async function shouldRetryAuthRequest(
  response: Response | null,
): Promise<boolean> {
  if (response === null) return true;
  if (response.status < 500) return false;
  return !(await isPasswordCheckRefusal(response));
}

async function isPasswordCheckRefusal(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  // A proxy's error page is not ours to read.
  if (!response.headers.get('content-type')?.includes('json')) return false;
  try {
    const body: unknown = await response.clone().json();
    return (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'PASSWORD_CHECK_BUSY'
    );
  } catch (error) {
    console.warn('[auth] an error answer did not parse as JSON:', error);
    return false;
  }
}
