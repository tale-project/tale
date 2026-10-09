import { externalDepError, preconditionError } from '../../utils/fail';
import type { NativeFetch } from '../config/native-http';

/** One guard covers the existing identity helper and the separate release
 * verifier. Auth session lifecycle is the only admitted HTTP mutation. */
export function observationHttp(
  allowedReads: ReadonlySet<string>,
  fetchImpl: NativeFetch = fetch,
  now: () => number = performance.now.bind(performance),
  maximumMs = 50_000,
) {
  const deadline = now() + maximumMs;
  let calls = 0;
  let bytes = 0;
  let signedOut = false;
  const authPosts = new Set([
    '/api/auth/sign-in/email',
    '/api/auth/organization/set-active',
    '/api/auth/sign-out',
  ]);
  const request = async (
    input: string | URL,
    init: RequestInit,
  ): Promise<Response> => {
    const target = new URL(input);
    const method = init.method ?? 'GET';
    const signOut =
      method === 'POST' && target.pathname === '/api/auth/sign-out';
    if (
      target.origin !== 'http://127.0.0.1:3005' ||
      target.username ||
      target.password ||
      target.hash ||
      init.redirect !== 'error' ||
      (method !== 'GET' &&
        !(method === 'POST' && authPosts.has(target.pathname))) ||
      (method === 'GET' && !allowedReads.has(target.pathname))
    )
      throw preconditionError(
        'Native observation refused a request outside its read-only boundary.',
      );
    // Reserve the final five seconds for the existing finally/sign-out path.
    const remaining = deadline - now() - (signOut ? 0 : 5000);
    if (remaining <= 0 || (signOut ? signedOut : ++calls > 8191))
      throw preconditionError(
        'Native observation exceeded its request budget.',
      );
    if (signOut) signedOut = true;
    let response;
    try {
      response = await fetchImpl(target, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(
          Math.max(1, Math.floor(Math.min(10_000, remaining))),
        ),
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.length;
            if (!signOut) bytes += next.value.length;
            if (
              size > (signOut ? 65536 : 32 * 1024 * 1024) ||
              (!signOut && bytes > 64 * 1024 * 1024) ||
              now() >= deadline
            )
              throw Error('bound');
            chunks.push(next.value);
          }
        } finally {
          await reader.cancel();
        }
      }
      return new Response(
        response.status === 204 ? null : Buffer.concat(chunks),
        {
          status: response.status,
          headers: response.headers,
        },
      );
    } catch {
      throw externalDepError(
        'Native observation transport failed or exceeded its bounded response.',
      );
    }
  };
  return { request, remaining: () => deadline - now() };
}
