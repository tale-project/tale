import type { Proxy } from '@/lib/api/schemas';

/** A check of the proxy is running (or queued): its row shows "Checking". */
export function isChecking(proxy: Proxy): boolean {
  return proxy.check.status === 'checking';
}
