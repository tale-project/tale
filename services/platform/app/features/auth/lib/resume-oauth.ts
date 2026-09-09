import { isSafeInternalPath } from '@/lib/shared/utils/safe-redirect';

/** OAuth continuation carries repeated signed query fields; preserve its URL byte for byte. */
export function resumeOAuthSignIn(returnTo: string | undefined): boolean {
  if (
    typeof window === 'undefined' ||
    !returnTo ||
    !isSafeInternalPath(returnTo)
  )
    return false;
  const base = window.__ENV__?.BASE_PATH ?? '';
  const url = new URL(returnTo, window.location.origin);
  if (
    ![`${base}/oauth/continue`, `${base}/oauth/consent`].includes(url.pathname)
  )
    return false;
  window.location.assign(url.toString());
  return true;
}
