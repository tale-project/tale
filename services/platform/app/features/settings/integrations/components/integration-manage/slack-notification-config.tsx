'use client';

import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { Input } from '@tale/ui/input';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useMemo, useState } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { useListAgents } from '@/app/features/agents/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import {
  listNotificationEventTypes,
  NOTIFICATION_EVENTS,
} from '@/convex/notifications/event_catalog';
import { useT } from '@/lib/i18n/client';

import { useUpdateCredentials } from '../../hooks/mutations';
import type { Integration } from '../../hooks/use-integration-manage';

interface SlackNotificationConfigProps {
  integration: Integration;
  organizationId: string;
}

/**
 * Slack-specific settings shown for a connected Slack integration: which agent
 * answers inbound messages, which channels receive notifications, and per-event
 * toggles. The toggle list is generated from the notification event catalog, so
 * a new event type appears here automatically. Persists to the per-org
 * `connectionConfig` via the existing saveCredentials action.
 */
export function SlackNotificationConfig({
  integration,
  organizationId,
}: SlackNotificationConfigProps) {
  const { t } = useT('settings');
  const { agents } = useListAgents(organizationId);
  const { mutateAsync: updateCredentials } = useUpdateCredentials();

  const cfg: Record<string, unknown> = integration.connectionConfig ?? {};
  const initialAgentSlug =
    typeof cfg.slackAgentSlug === 'string' ? cfg.slackAgentSlug : '';
  const initialChannels = Array.isArray(cfg.notifyChannels)
    ? cfg.notifyChannels.filter((c): c is string => typeof c === 'string')
    : [];
  const initialEvents: Record<string, boolean> =
    cfg.notifyEvents && typeof cfg.notifyEvents === 'object'
      ? Object.fromEntries(
          Object.entries(cfg.notifyEvents).filter(
            ([, val]) => typeof val === 'boolean',
          ),
        )
      : {};

  const [agentSlug, setAgentSlug] = useState(initialAgentSlug);
  const [channelsText, setChannelsText] = useState(initialChannels.join(', '));
  const [notifyEvents, setNotifyEvents] = useState(initialEvents);
  const [saving, setSaving] = useState(false);

  const agentOptions = useMemo(() => {
    const list = Array.isArray(agents) ? agents : [];
    return list.flatMap((a) => {
      if (!a) return [];
      const label =
        'displayName' in a && a.displayName ? a.displayName : a.name;
      return [{ value: a.name, label }];
    });
  }, [agents]);

  const eventTypes = useMemo(() => listNotificationEventTypes(), []);

  const isEnabled = (type: (typeof eventTypes)[number]) =>
    typeof notifyEvents[type] === 'boolean'
      ? notifyEvents[type]
      : NOTIFICATION_EVENTS[type].defaultEnabled;

  const handleSave = async () => {
    setSaving(true);
    try {
      const notifyChannels = channelsText
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      await updateCredentials({
        credentialId: toId<'integrationCredentials'>(integration._id),
        connectionConfig: {
          ...integration.connectionConfig,
          slackAgentSlug: agentSlug || undefined,
          notifyChannels,
          notifyEvents,
        },
      });
      toast({ title: t('integrations.slackNotify.saved') });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t('integrations.slackNotify.saveFailed'),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <BorderedSection>
      <Stack gap={3}>
        <Text variant="label">{t('integrations.slackNotify.title')}</Text>

        <Select
          label={t('integrations.slackNotify.agentLabel')}
          placeholder={t('integrations.slackNotify.agentPlaceholder')}
          value={agentSlug}
          onValueChange={setAgentSlug}
          options={agentOptions}
        />

        <Stack gap={1}>
          <Text variant="label" className="text-sm">
            {t('integrations.slackNotify.channelsLabel')}
          </Text>
          <Input
            value={channelsText}
            onChange={(e) => setChannelsText(e.target.value)}
            placeholder="C0123ABCD, C0456EFGH"
          />
          <Text variant="muted" className="text-xs">
            {t('integrations.slackNotify.channelsHint')}
          </Text>
        </Stack>

        <Stack gap={2}>
          <Text variant="label" className="text-sm">
            {t('integrations.slackNotify.eventsLabel')}
          </Text>
          {eventTypes.map((type) => (
            <HStack key={type} gap={2} align="center">
              <Checkbox
                id={`slack-notify-${type}`}
                checked={isEnabled(type)}
                onCheckedChange={(checked) =>
                  setNotifyEvents((prev) => ({
                    ...prev,
                    [type]: checked === true,
                  }))
                }
              />
              <label
                htmlFor={`slack-notify-${type}`}
                className="cursor-pointer text-sm"
              >
                {t(NOTIFICATION_EVENTS[type].titleKey)}
              </label>
            </HStack>
          ))}
        </Stack>

        <HStack justify="end">
          <Button onClick={handleSave} disabled={saving}>
            {saving
              ? t('integrations.slackNotify.saving')
              : t('integrations.slackNotify.save')}
          </Button>
        </HStack>
      </Stack>
    </BorderedSection>
  );
}
