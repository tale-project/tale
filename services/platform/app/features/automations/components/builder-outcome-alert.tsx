'use client';

import { Alert } from '@tale/ui/alert';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { ProviderKeyErrorAction } from '@/app/features/chat/components/provider-settings-action';
import { useT } from '@/lib/i18n/client';

import {
  builderOutcomeBodyText,
  builderOutcomeUsesFailedTitle,
  builderOutcomeVariant,
  builderShowsProviderSettingsAction,
  builderShowsTechnicalDetails,
  sanitizeBuilderReason,
} from '../lib/builder-error-display';

export function BuilderOutcomeAlert({
  organizationId,
  providerSlug,
  kind,
  reason,
}: {
  organizationId: string;
  /** Selected provider slug — fills named auth hints when the reason omits it. */
  providerSlug?: string;
  kind: 'failed' | 'gave-up';
  reason: string;
}) {
  const { t } = useT('automations');
  const { t: tChat } = useT('chat');
  const sanitized = sanitizeBuilderReason(reason, providerSlug);
  const body = builderOutcomeBodyText(sanitized, reason, tChat);
  const variant = builderOutcomeVariant(sanitized.code, kind);
  const title = builderOutcomeUsesFailedTitle(sanitized.code, kind)
    ? t('builder.outcomeFailedTitle')
    : t('builder.outcomeGaveUpTitle');
  const showDetails = builderShowsTechnicalDetails(sanitized, body);
  const showProviderAction = builderShowsProviderSettingsAction(sanitized.code);

  return (
    <Alert
      variant={variant}
      title={title}
      description={
        <Stack gap={2}>
          <Text as="p" variant="muted" className="text-sm">
            {body}
          </Text>
          {showDetails && sanitized.rawMessage !== undefined && (
            <CollapsibleDetails
              variant="compact"
              summary={tChat('errorDetailsSummary')}
              open={sanitized.code === 'generic'}
            >
              <p className="text-muted-foreground mt-1 font-mono text-xs break-words whitespace-pre-wrap opacity-70">
                {sanitized.rawMessage}
              </p>
            </CollapsibleDetails>
          )}
          {showProviderAction && (
            <ProviderKeyErrorAction organizationId={organizationId} />
          )}
        </Stack>
      }
    />
  );
}
