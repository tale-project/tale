import { randomUUID } from 'node:crypto';

/** Public correlation metadata, never authentication or a persistent deployment ID.
 * A reader binds it to a captured local container, then compares the origin's
 * response. A declaration/environment value cannot provide that correlation. */
export const SERVING_IDENTITY_HEADER = 'Tale-Serving-Identity';

/** Call once per server bootstrap. Memory only: rootless/read-only images need
 * no writable directory, secret, stable host name or deployment configuration. */
export function createServingIdentity(service: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}(?![\s\S])/.test(service))
    throw new Error('Serving identity requires a bounded service name.');
  return `v1;service=${service};instance=${randomUUID()}`;
}
