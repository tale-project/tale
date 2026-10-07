import { externalDepError } from '../../utils/fail';
import { acceptanceServingSchema } from './acceptance-model';

/** No redirect, cookies or credentials. The canonical HTTPS origin must itself
 * report the selected version. The response names no deployment, so it proves
 * version reachability only. Cancellation covers body reads. */
export async function acceptanceHealth(
  origin: string,
  expectedVersion: string,
  timeoutMs: number,
  request: typeof fetch = fetch,
) {
  const signal = AbortSignal.timeout(
    Math.min(10_000, Math.max(1, Math.floor(timeoutMs))),
  );
  let response: Response | undefined;
  let reader:
    | ReturnType<NonNullable<Response['body']>['getReader']>
    | undefined;
  try {
    response = await request(`${origin}/api/health`, {
      signal,
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (response.status !== 200 || !response.body)
      throw new Error('health status');
    const bodyReader = response.body.getReader();
    reader = bodyReader;
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await bodyReader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 65536) throw new Error('health bound');
      chunks.push(next.value);
    }
    const serving = acceptanceServingSchema.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      ),
    );
    if (serving.version !== expectedVersion) throw new Error('health version');
    return serving;
  } catch {
    throw externalDepError(
      'The declared origin did not prove the expected healthy serving version.',
    );
  } finally {
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* Preserve the safe primary failure. */
      }
      reader.releaseLock();
    } else if (response?.body) await response.body.cancel().catch(() => {});
  }
}
