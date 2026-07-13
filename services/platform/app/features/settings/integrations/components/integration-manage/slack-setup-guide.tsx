'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { Label } from '@/app/components/ui/forms/label';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';

import { useSlackSetupInfo } from '../../hooks/use-slack-setup-info';

const SLACK_APPS_URL = 'https://api.slack.com/apps';

/**
 * "Bring your own Slack app" setup helper. Shows the deployment's Events API
 * Request URL + OAuth redirect URL (server-derived from SITE_URL/BASE_PATH) and
 * a copyable Slack App Manifest, so an admin can create their own Slack app in a
 * couple of clicks and then paste its Client ID / Secret / Signing Secret into
 * the credentials form above.
 */
export function SlackSetupGuide({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { data, isLoading, error } = useSlackSetupInfo(organizationId);
  const { copied, onClick: copyManifest } = useCopyButton(data?.manifest ?? '');

  if (isLoading) {
    return (
      <HStack className="text-muted-foreground items-center">
        <Loader2 className="size-4 animate-spin" />
      </HStack>
    );
  }
  if (error || !data) return null;

  return (
    <Card padding="sm">
      <Stack gap={3}>
        <Stack gap={1}>
          <Text variant="label">{t('integrations.slackSetup.title')}</Text>
          <Text variant="body-sm" className="text-muted-foreground">
            {t('integrations.slackSetup.intro')}
          </Text>
        </Stack>

        <a
          href={SLACK_APPS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
        >
          {t('integrations.slackSetup.openSlackApps')}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>

        <Stack gap={2}>
          <HStack className="items-center justify-between">
            <Label>{t('integrations.slackSetup.manifest')}</Label>
            <Button type="button" variant="secondary" onClick={copyManifest}>
              {copied ? (
                <Check className="mr-1.5 size-3.5" />
              ) : (
                <Copy className="mr-1.5 size-3.5" />
              )}
              {copied ? tCommon('actions.copied') : tCommon('actions.copy')}
            </Button>
          </HStack>
          <Card
            asChild
            padding="sm"
            className="bg-muted/40 max-h-64 overflow-auto font-mono text-xs"
          >
            <pre>{data.manifest}</pre>
          </Card>
        </Stack>

        <CopyableField
          label={t('integrations.slackSetup.requestUrl')}
          description={t('integrations.slackSetup.requestUrlHelp')}
          value={data.eventsUrl}
        />
        <CopyableField
          label={t('integrations.slackSetup.redirectUrl')}
          description={t('integrations.slackSetup.redirectUrlHelp')}
          value={data.redirectUrl}
        />
      </Stack>
    </Card>
  );
}
