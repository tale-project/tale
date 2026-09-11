import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import type { NativeClientContext } from '../deployment/native-client';
import { createNativeHttp, type NativeHttpOptions } from './native-http';
import type { ConfigurationPlan } from './platform-model';

export interface PlatformConfigurationClient {
  target: ConfigurationPlan['target'];
  request: (path: string, method?: string, body?: unknown) => Promise<unknown>;
}

/** Managed deployment has already proved its session and organization. Reuse
 * that context without exposing a cookie or opening a second login session. */
export function configurationClient(
  context: NativeClientContext,
): PlatformConfigurationClient {
  return {
    target: {
      origin: context.origin,
      organizationId: context.organization.id,
      organizationSlug: context.organization.slug,
    },
    request: async (path, method = 'GET', body) => {
      const separator = path.includes('?') ? '&' : '?';
      return context.requireJson(
        await context.request(
          `${path}${separator}orgId=${encodeURIComponent(context.organization.id)}`,
          method,
          body,
        ),
        'Native platform configuration',
      );
    },
  };
}

/** Standalone commands prove membership read-only. They never change the active
 * organization in a browser session just to inspect or apply a declaration. */
export async function connectPlatformConfiguration(
  options: NativeHttpOptions,
): Promise<PlatformConfigurationClient> {
  const transport = createNativeHttp(options);
  const session = z
    .object({
      user: z.object({ id: z.string().min(1) }),
      session: z.object({ userId: z.string().min(1) }),
    })
    .parse(await transport.request('/api/auth/get-session'));
  const organizations = z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        slug: z.string().min(1).max(64),
      }),
    )
    .max(10_000)
    .parse(await transport.request('/api/auth/organization/list'));
  const matches = organizations.filter(
    (organization) => organization.id === options.orgId,
  );
  const organization = matches[0];
  if (
    session.user.id !== session.session.userId ||
    matches.length !== 1 ||
    !organization
  )
    throw preconditionError(
      'The native session does not prove the requested organization membership.',
    );
  return {
    target: {
      origin: transport.origin,
      organizationId: organization.id,
      organizationSlug: organization.slug,
    },
    request: (path, method, body) => transport.request(path, { method, body }),
  };
}
