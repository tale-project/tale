'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { EVENT_TYPES } from '@/convex/events/emit';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteAutomationTrigger,
  useSetAutomationTrigger,
} from '../hooks/mutations';
import { useAutomationTriggers } from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';

const TRIGGER_KINDS = ['schedule', 'webhook', 'event'] as const;
type TriggerKind = (typeof TRIGGER_KINDS)[number];

function isTriggerKind(value: string): value is TriggerKind {
  return (TRIGGER_KINDS as readonly string[]).includes(value);
}

/**
 * The automation's trigger binding: what starts it, and whether it is armed.
 *
 * One binding per automation (the store replaces in place), so this is an
 * editor over a single row: pick a kind, fill the kind's own fields, save.
 * A webhook's token is the one stateful subtlety — the server returns the
 * plaintext exactly once, on mint or rotation, and this panel is the only
 * chance to copy it; afterwards only "a token exists" survives.
 *
 * A trigger fires nothing until a version is deployed — `beginRun` resolves
 * through the deployment — which is why the panel never warns about arming a
 * draft: arming is safe by construction.
 *
 * Laid out as a self-contained card so it can sit beside the Projects panel
 * on wide screens: header, growing body, actions pinned to the bottom.
 */
export function TriggerEditor({
  organizationId,
  name,
  /** Authoring is developer-gated server-side; readers still see the binding. */
  canEdit,
}: {
  organizationId: string;
  name: string;
  canEdit: boolean;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  // The public webhook endpoint. External callers POST here; the token is the
  // last path segment and is shown only once (stored as a hash), so a revisit
  // shows a `<token>` placeholder and points to Rotate. The origin the operator
  // is browsing IS the deployment origin (dev proxies /api/* to Convex), so it
  // is the base of the URL an external caller uses.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const webhookUrl = (token: string): string =>
    `${origin}/api/automations/webhook/${token}`;
  const headingId = useId();
  const cronId = useId();
  const timezoneId = useId();
  const eventId = useId();

  const triggersQuery = useAutomationTriggers(organizationId, name);
  const setTrigger = useSetAutomationTrigger();
  const deleteTrigger = useDeleteAutomationTrigger();

  const stored = triggersQuery.data?.[0];

  const [kind, setKind] = useState<TriggerKind>('schedule');
  const [cron, setCron] = useState('');
  const [timezone, setTimezone] = useState('');
  const [eventName, setEventName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Load the stored binding into the form whenever it changes under us —
  // the row is the truth; local state only carries unsaved edits.
  useEffect(() => {
    if (stored === undefined) return;
    if (isTriggerKind(stored.kind)) setKind(stored.kind);
    setCron(stored.cron ?? '');
    setTimezone(stored.timezone ?? '');
    setEventName(stored.event ?? '');
    setEnabled(stored.enabled);
  }, [stored]);

  const dirty = useMemo(() => {
    if (stored === undefined) {
      return (
        cron !== '' ||
        timezone !== '' ||
        eventName !== '' ||
        kind !== 'schedule'
      );
    }
    return (
      kind !== stored.kind ||
      cron !== (stored.cron ?? '') ||
      timezone !== (stored.timezone ?? '') ||
      eventName !== (stored.event ?? '') ||
      enabled !== stored.enabled
    );
  }, [stored, kind, cron, timezone, eventName, enabled]);

  const save = (rotateToken?: boolean) => {
    setRefusal(null);
    setMintedToken(null);
    setTrigger.mutate(
      {
        organizationId,
        name,
        trigger: {
          kind,
          ...(kind === 'schedule' && cron !== '' && { cron }),
          ...(kind === 'schedule' && timezone !== '' && { timezone }),
          ...(kind === 'event' && eventName !== '' && { event: eventName }),
          enabled,
        },
        ...(rotateToken === true && { rotateToken: true }),
      },
      {
        onSuccess: (result) => {
          if (result.token !== undefined) setMintedToken(result.token);
        },
        onError: (error) => {
          setRefusal(automationErrorMessage(error));
        },
      },
    );
  };

  return (
    <section
      aria-labelledby={headingId}
      className="border-border flex h-full min-w-0 flex-col gap-4 rounded-lg border p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-sm font-semibold">
              {t('trigger.title')}
            </h3>
            {stored !== undefined && (
              <Badge variant={stored.enabled ? 'green' : 'slate'}>
                {stored.enabled
                  ? t('trigger.enabledBadge')
                  : t('trigger.disabledBadge')}
              </Badge>
            )}
          </div>
          {stored?.lastFiredAt !== undefined && (
            <Text as="p" variant="muted" className="text-xs">
              {t('trigger.lastFired', {
                at: formatDate(new Date(stored.lastFiredAt), 'long'),
              })}
            </Text>
          )}
        </div>
        {(canEdit || stored !== undefined) && (
          <Switch
            label={t('trigger.enabledLabel')}
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!canEdit}
          />
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {stored === undefined && !canEdit && (
          <Text as="p" variant="muted" className="text-sm">
            {t('trigger.none')}
          </Text>
        )}

        {refusal !== null && (
          <Alert variant="destructive" description={refusal} />
        )}

        {mintedToken !== null && (
          <Alert
            variant="warning"
            icon={KeyRound}
            title={t('trigger.tokenTitle')}
            description={
              <span className="flex flex-col gap-1">
                <span>{t('trigger.webhookHowto')}</span>
                <code className="bg-muted rounded px-1.5 py-0.5 text-xs break-all select-all">
                  curl -X POST {webhookUrl(mintedToken)}
                </code>
                <span>{t('trigger.tokenHint')}</span>
              </span>
            }
          />
        )}

        {(canEdit || stored !== undefined) && (
          <div
            className={
              kind === 'schedule'
                ? 'grid gap-3 sm:grid-cols-3'
                : 'grid gap-3 sm:grid-cols-2'
            }
          >
            <Select
              label={t('trigger.kindLabel')}
              options={TRIGGER_KINDS.map((value) => ({
                value,
                label: t(`trigger.kinds.${value}`),
              }))}
              value={kind}
              onValueChange={(value) => {
                if (isTriggerKind(value)) setKind(value);
              }}
              disabled={!canEdit}
              className="min-w-0"
            />
            {kind === 'schedule' && (
              <>
                <Field label={t('trigger.cronLabel')} htmlFor={cronId}>
                  <Input
                    id={cronId}
                    value={cron}
                    placeholder="0 */6 * * *"
                    readOnly={!canEdit}
                    onChange={(event) => setCron(event.target.value)}
                    className="font-mono"
                  />
                </Field>
                <Field label={t('trigger.timezoneLabel')} htmlFor={timezoneId}>
                  <Input
                    id={timezoneId}
                    value={timezone}
                    placeholder="UTC"
                    readOnly={!canEdit}
                    onChange={(event) => setTimezone(event.target.value)}
                  />
                </Field>
              </>
            )}
            {kind === 'event' && (
              <Field label={t('trigger.eventLabel')} htmlFor={eventId}>
                <Select
                  id={eventId}
                  placeholder={t('trigger.eventPlaceholder')}
                  disabled={!canEdit}
                  options={EVENT_TYPES.map((value) => ({
                    value,
                    label: value,
                  }))}
                  value={eventName}
                  onValueChange={(value) => {
                    // Radix fires a spurious '' on unmount — never un-pick.
                    if (value !== '') setEventName(value);
                  }}
                />
              </Field>
            )}
            {kind === 'webhook' && (
              <div className="flex flex-col gap-1 sm:col-span-1">
                <Text as="span" variant="muted" className="text-xs font-medium">
                  {t('trigger.webhookEndpointLabel')}
                </Text>
                <code className="bg-muted rounded px-1.5 py-0.5 text-xs break-all select-all">
                  curl -X POST {webhookUrl(mintedToken ?? '<token>')}
                </code>
                <Text as="span" variant="muted" className="text-xs">
                  {t('trigger.webhookHowto')}{' '}
                  {stored?.hasToken === true
                    ? t('trigger.hasToken')
                    : t('trigger.noToken')}
                </Text>
                <Text as="span" variant="muted" className="text-xs">
                  {t('trigger.webhookProjectHint')}
                </Text>
                <code className="bg-muted rounded px-1.5 py-0.5 text-xs break-all select-all">
                  curl -X POST{' '}
                  {`${webhookUrl(mintedToken ?? '<token>')}?projectId=<projectId>`}
                </code>
              </div>
            )}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            isLoading={setTrigger.isPending}
            disabled={!dirty && stored !== undefined}
            disabledReason={t('trigger.nothingToSave')}
            onClick={() => {
              save();
            }}
          >
            {t('trigger.save')}
          </Button>
          {kind === 'webhook' && stored?.hasToken === true && (
            <Button
              size="sm"
              variant="secondary"
              icon={KeyRound}
              isLoading={setTrigger.isPending}
              onClick={() => {
                save(true);
              }}
            >
              {t('trigger.rotate')}
            </Button>
          )}
          {stored !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              isLoading={deleteTrigger.isPending}
              onClick={() => {
                setConfirmRemove(true);
              }}
            >
              {t('trigger.remove')}
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('trigger.removeTitle')}
        description={t('trigger.removeBody')}
        confirmText={t('trigger.remove')}
        variant="destructive"
        onConfirm={() => {
          setRefusal(null);
          setMintedToken(null);
          deleteTrigger.mutate(
            { organizationId, name },
            {
              onError: (error) => {
                setRefusal(automationErrorMessage(error));
              },
            },
          );
        }}
      />
    </section>
  );
}
