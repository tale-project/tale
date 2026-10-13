import { Badge } from '@tale/ui/badge';
import { ConnectionIdentity } from '@tale/ui/connection-identity';
import { Stack } from '@tale/ui/layout';
import { TaleLogo } from '@tale/ui/logo';
import { Text } from '@tale/ui/text';
import { ShieldCheck, TriangleAlert } from 'lucide-react';

import { agentClientMark } from '@/app/lib/agent-clients';
import type { AgentConsentContext } from '@/app/lib/backend/agent-connections';
import { useT } from '@/lib/i18n/client';

import type { RedirectPlace } from './agent-consent-request';

/**
 * The picture above the title of the consent page: the app on the left, Tale
 * on the right. The app's own icon is shown only for a host Tale verified; an
 * app that registered itself gets the neutral glyph, as an icon is a claim of
 * who it is.
 */
export function AgentClientMark({
  client,
}: {
  client: AgentConsentContext['client'];
}) {
  const { t } = useT('agentConnections');
  const Mark = agentClientMark(
    client.provenance === 'metadata_document' ? client.host : null,
  );
  return (
    <ConnectionIdentity
      className="mx-auto"
      label={t('consent.picture', { client: client.name })}
      from={<Mark className="size-6" />}
      to={<TaleLogo wordmark={false} className="size-6" />}
    />
  );
}

/**
 * Who vouched for the app and where the person goes back to: a verified
 * domain, or a warning that the app registered itself and chose its own name,
 * and the place the browser returns to when they connect.
 */
export function AgentClientProvenance({
  client,
  redirect,
}: {
  client: AgentConsentContext['client'];
  redirect: RedirectPlace | null;
}) {
  const { t } = useT('agentConnections');
  const verified = client.provenance === 'metadata_document';
  return (
    <Stack gap={2} align="start">
      {verified ? (
        <>
          <Badge variant="green" icon={ShieldCheck}>
            {t('consent.verified', { host: client.host ?? '' })}
          </Badge>
          <Text variant="caption">
            {t('consent.verifiedHelp', { host: client.host ?? '' })}
          </Text>
        </>
      ) : (
        <>
          <Badge variant="yellow" icon={TriangleAlert}>
            {t('consent.unverified')}
          </Badge>
          <Text variant="caption" role="note">
            {t('consent.unverifiedHelp')}
          </Text>
        </>
      )}
      {redirect !== null ? (
        <Text variant="caption">
          {redirect.loopback
            ? t('consent.returnsToComputer', { host: redirect.host })
            : t('consent.returnsToSite', { host: redirect.host })}
        </Text>
      ) : null}
    </Stack>
  );
}
