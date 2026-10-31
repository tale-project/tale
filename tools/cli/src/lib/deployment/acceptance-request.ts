import { Agent as HttpAgent, get as httpGet } from 'node:http';
import { Agent as HttpsAgent, get as httpsGet } from 'node:https';
import { isIPv4 } from 'node:net';

/** The step of an origin health check that failed, with an authored detail:
 * never a response body, a header value or a raw network error message. */
export class HealthStepError extends Error {
  constructor(
    readonly step: 'connect' | 'status' | 'identity' | 'body' | 'version',
    detail: string,
  ) {
    super(`${step}: ${detail}`);
    this.name = 'HealthStepError';
  }
}

/** A dedicated direct agent avoids ambient HTTP(S)_PROXY routing. Bun 1.4.2
 * fetch does not implement the newer proxy:false option. HTTPS keeps normal
 * certificate/hostname validation; this reader never redirects or sends auth. */
export async function acceptanceRequest(
  url: string,
  signal: AbortSignal,
  address?: string,
): Promise<Response> {
  const target = new URL(url);
  const secure = target.protocol === 'https:';
  if (
    !secure &&
    !(target.protocol === 'http:' && target.hostname === '127.0.0.1')
  )
    throw new Error('Unsupported health observation URL');
  if (address !== undefined && (!secure || !isIPv4(address)))
    throw new Error('Invalid captured origin address');
  if (target.username || target.password)
    throw new Error('Health URL has credentials');
  const agent = secure
    ? new HttpsAgent({ keepAlive: false, rejectUnauthorized: true })
    : new HttpAgent({ keepAlive: false });
  try {
    return await new Promise<Response>((resolve, reject) => {
      // Once an answer arrived, a failure belongs to reading its body.
      let answered = false;
      const request = (secure ? httpsGet : httpGet)(
        target,
        {
          agent,
          // Replace only connection lookup. The URL still owns Host, SNI and
          // certificate hostname validation; no ambient proxy is involved.
          ...(address === undefined
            ? {}
            : {
                lookup: (_hostname, options, callback) =>
                  callback(
                    null,
                    options.all ? [{ address, family: 4 }] : address,
                    4,
                  ),
              }),
          rejectUnauthorized: true,
          signal,
          maxHeaderSize: 8192,
          headers: { 'Cache-Control': 'no-cache' },
        },
        (response) => {
          answered = true;
          const identities: string[] = [];
          for (let index = 0; index < response.rawHeaders.length; index += 2)
            if (
              response.rawHeaders[index]?.toLowerCase() ===
              'tale-serving-identity'
            )
              identities.push(response.rawHeaders[index + 1] ?? '');
          const fail = (failure: HealthStepError) => {
            response.destroy();
            request.destroy();
            reject(failure);
          };
          if (response.statusCode !== 200) {
            fail(new HealthStepError('status', `HTTP ${response.statusCode}`));
            return;
          }
          if (identities.length !== 1 || identities[0].length > 128) {
            fail(new HealthStepError('identity', 'absent or invalid'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) fail(new HealthStepError('body', 'over 64 KiB'));
            else chunks.push(chunk);
          });
          response.once('error', () =>
            reject(new HealthStepError('body', 'unreadable')),
          );
          response.once('end', () => {
            try {
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: 200,
                  headers: { 'Tale-Serving-Identity': identities[0] },
                }),
              );
            } catch {
              // Only the identity, an arbitrary header value, can refuse here.
              reject(new HealthStepError('identity', 'absent or invalid'));
            }
          });
        },
      );
      request.once('error', (error) =>
        reject(answered ? new HealthStepError('body', 'unreadable') : error),
      );
    });
  } finally {
    agent.destroy();
  }
}
