'use client';

import { Alert } from '@tale/ui/alert';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';
import { CredentialRow } from './credential-row';

/**
 * A vendor's credentials, plus the one health state that is shared by both
 * surfaces: a set of credentials that lost its default.
 *
 * That state is surfaced, never repaired. An invocation naming no credential
 * falls back to the default, so with none set some calls simply have nothing to
 * use — and picking a replacement silently would be choosing which key an
 * organization authenticates with on its behalf.
 *
 * `alerts` carries the surface-specific health states (a stale OAuth grant, an
 * unreachable model catalog) so they render in the same band as this one.
 */
export function CredentialList<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  vendor,
  credentials,
  adapter,
  alerts,
  emptyBody,
}: {
  organizationId: string;
  vendor: V;
  credentials: readonly Cred[];
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  alerts?: ReactNode;
  /** Surface-specific "how do I add one" copy for the empty state. */
  emptyBody: ReactNode;
}) {
  const { t } = useT('settings');

  const hasNoDefault =
    credentials.length > 0 &&
    !credentials.some((credential) => credential.isDefault);

  return (
    <Stack gap={4}>
      {alerts}
      {hasNoDefault && (
        <Alert variant="warning" description={t('credentials.noDefault')} />
      )}

      {credentials.length > 0 ? (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {credentials.map((credential) => (
            <CredentialRow
              key={credential.id}
              organizationId={organizationId}
              credential={credential}
              vendor={vendor}
              adapter={adapter}
            />
          ))}
        </ul>
      ) : (
        <div className="border-border rounded-lg border border-dashed px-4 py-6">
          <Stack gap={1}>
            <Text as="p" variant="label">
              {t('credentials.emptyTitle')}
            </Text>
            {emptyBody}
          </Stack>
        </div>
      )}
    </Stack>
  );
}
