/**
 * URL rewrite helpers for the integration sandbox.
 *
 * Re-exports the shared storage URL utilities from lib/helpers/public_storage_url
 * and adds sandbox-specific host validation logic.
 */

export {
  toInternalStorageUrl,
  isStorageUrl,
} from '../../../lib/helpers/public_storage_url';

import {
  toInternalStorageUrl,
  isStorageUrl,
} from '../../../lib/helpers/public_storage_url';
import { toMockUrl } from './mock_rewrite';
import { validateHost } from './validate_host';

/**
 * Resolve a URL (rewriting storage URLs to internal) and validate
 * the host against the allowlist if applicable.
 *
 * Returns the resolved URL. Throws if host validation fails.
 */
export function resolveAndValidateUrl(
  url: string,
  allowedHosts?: string[],
): string {
  // Offline-test redirect (only when `TALE_MOCK_INTEGRATIONS_BASE` is set):
  // send known third-party origins to the local mock gateway. The mock host is
  // operator-controlled loopback, so it bypasses the allowedHosts check (which
  // lists the real upstream, not the mock).
  const mocked = toMockUrl(url);
  if (mocked) return mocked;

  const resolved = toInternalStorageUrl(url);
  if (!isStorageUrl(resolved) && allowedHosts && allowedHosts.length > 0) {
    validateHost(resolved, allowedHosts);
  }
  return resolved;
}
