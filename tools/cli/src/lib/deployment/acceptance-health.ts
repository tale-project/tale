import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import {
  acceptanceVersionSchema,
  servingProcessSchema,
  type ServingProcess,
} from './acceptance-model';
import { acceptanceRequest, HealthStepError } from './acceptance-request';

const HEADER = 'Tale-Serving-Identity';
export const SERVING_ENDPOINTS = {
  platform: { port: 3000, path: '/api/health' },
  'backend-api': { port: 3005, path: '/api/health/ready' },
} as const;
export type ServingService = keyof typeof SERVING_ENDPOINTS;

/** Strict reader of the generic UI server's public wire contract. Duplicate
 * HTTP fields are comma-joined by Headers and therefore cannot match. */
export function servingIdentity(
  value: unknown,
  service: string,
): ServingProcess {
  const match =
    typeof value === 'string' && value.length <= 128
      ? /^v1;service=([a-z][a-z0-9-]{0,63});instance=([a-f0-9-]{36})(?![\s\S])/.exec(
          value,
        )
      : null;
  const parsed = servingProcessSchema.safeParse(
    match && { service: match[1], instance: match[2] },
  );
  if (!parsed.success || parsed.data.service !== service)
    throw externalDepError(
      'The serving process identity is absent or invalid.',
    );
  return parsed.data;
}

/** Captured loopback HTTP must not inherit the container's external proxy. */
export function localHttpEnvironmentArgs(): string[] {
  return [
    ...[
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ].flatMap((name) => ['--env', `${name}=`]),
    '--env',
    'NO_PROXY=*',
    '--env',
    'no_proxy=*',
  ];
}

/** Fixed read-only projection in the captured container. It prints no body,
 * environment or credentials, and needs neither a shell nor writable storage. */
export function localServingArgs(
  id: string,
  service: ServingService,
): string[] {
  const endpoint = SERVING_ENDPOINTS[service];
  const url = `http://127.0.0.1:${endpoint.port}${endpoint.path}`;
  return [
    'exec',
    ...localHttpEnvironmentArgs(),
    id,
    'bun',
    '--eval',
    `const r=await fetch(${JSON.stringify(url)},{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000)});try{console.log(JSON.stringify({status:r.status,identity:r.headers.get(${JSON.stringify(HEADER)})}));}finally{await r.body?.cancel();}`,
  ];
}

export function localServingIdentity(
  raw: string,
  service: ServingService,
): ServingProcess {
  try {
    const value = z
      .strictObject({ status: z.literal(200), identity: z.string().max(128) })
      .parse(JSON.parse(raw));
    return servingIdentity(value.identity, service);
  } catch {
    throw externalDepError(
      'The captured local server did not prove a healthy process identity.',
    );
  }
}

/** What failed in a health check, for its refusal: the step and an authored
 * detail. A network failure shows only its error code, an identifier such as
 * `ENOTFOUND` or `CERT_HAS_EXPIRED`, never its message. */
function healthFailure(
  error: unknown,
  step: HealthStepError['step'],
  signal: AbortSignal,
): string {
  const failed = error instanceof HealthStepError ? error.step : step;
  if (signal.aborted) return `${failed}: timed out`;
  if (error instanceof HealthStepError) return error.message;
  if (failed === 'identity') return 'identity: absent or invalid';
  if (failed !== 'connect') return `${failed}: unreadable`;
  const codes = [error, error instanceof Error ? error.cause : undefined].map(
    (value) =>
      value instanceof Object && 'code' in value ? value.code : undefined,
  );
  const code = codes.find(
    (value): value is string =>
      typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value),
  );
  return `connect: ${code ?? 'failed'}`;
}

/** No redirect, cookies or credentials. The deployment's canonical HTTPS
 * origin must itself serve the selected version. Cancellation covers body reads.
 * A refusal names the step that failed: connect, status, identity, body or
 * version. */
export async function acceptanceHealth(
  origin: string,
  expectedVersion: string,
  expected: ServingProcess,
  timeoutMs: number,
  request?: typeof fetch,
  address?: string,
) {
  const endpoint = SERVING_ENDPOINTS[expected.service as ServingService];
  if (!endpoint)
    throw externalDepError('Unsupported serving process identity.');
  const signal = AbortSignal.timeout(
    Math.min(10_000, Math.max(1, Math.floor(timeoutMs))),
  );
  let response: Response | undefined;
  let reader:
    | ReturnType<NonNullable<Response['body']>['getReader']>
    | undefined;
  // The step in progress names a failure that is not one of its checks.
  let step: HealthStepError['step'] = 'connect';
  try {
    response = request
      ? await request(`${origin}${endpoint.path}`, {
          signal,
          redirect: 'error',
          credentials: 'omit',
          headers: { 'Cache-Control': 'no-cache' },
        })
      : await acceptanceRequest(`${origin}${endpoint.path}`, signal, address);
    if (response.status !== 200)
      throw new HealthStepError('status', `HTTP ${response.status}`);
    if (!response.body) throw new HealthStepError('body', 'empty');
    step = 'identity';
    const observed = servingIdentity(
      response.headers.get(HEADER),
      expected.service,
    );
    if (observed.instance !== expected.instance)
      throw new HealthStepError('identity', 'another serving process');
    step = 'body';
    const bodyReader = response.body.getReader();
    reader = bodyReader;
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await bodyReader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 65536) throw new HealthStepError('body', 'over 64 KiB');
      chunks.push(next.value);
    }
    let body: unknown;
    try {
      body = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw new HealthStepError('body', 'not UTF-8 JSON');
    }
    if (expected.service === 'platform') {
      const serving = z
        .strictObject({
          status: z.literal('ok'),
          version: acceptanceVersionSchema,
        })
        .safeParse(body);
      if (!serving.success)
        throw new HealthStepError('body', 'not a ready health answer');
      // Both versions are bounded semantic versions, safe to name.
      if (serving.data.version !== expectedVersion)
        throw new HealthStepError(
          'version',
          `${serving.data.version}, expected ${expectedVersion}`,
        );
    } else if (
      !z
        .strictObject({ ok: z.literal(true), service: z.literal('backend') })
        .safeParse(body).success
    )
      throw new HealthStepError('body', 'not a ready health answer');
    return observed;
  } catch (error) {
    throw externalDepError(
      `The declared origin did not prove the expected healthy serving version (${expected.service} ${healthFailure(error, step, signal)}).`,
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
