'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { EMITTED_EVENT_TYPES } from '@/lib/shared/event-types';

import {
  useDeleteAutomationTrigger,
  useSetAutomationTrigger,
} from '../hooks/mutations';
import { useAutomationTriggers } from '../hooks/queries';
import { useCronPreview } from '../hooks/use-cron-preview';
import { listTimezoneOptions } from '../lib/cron-preview';
import { automationErrorMessage } from '../lib/errors';

const TRIGGER_KINDS = ['schedule', 'webhook', 'event'] as const;
type TriggerKind = (typeof TRIGGER_KINDS)[number];

function isTriggerKind(value: string): value is TriggerKind {
  return (TRIGGER_KINDS as readonly string[]).includes(value);
}

/** Imperative surface for {@link WorkflowSettings}' single Save footer. */
export type TriggerEditorController = {
  dirty: boolean;
  pending: boolean;
  /** True when the schedule cron cannot be saved as typed. */
  blocked: boolean;
  canRotate: boolean;
  canRemove: boolean;
  removePending: boolean;
  save: () => void;
  rotate: () => void;
  requestRemove: () => void;
};

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
 * through the deployment — so arming a draft is safe by construction; the
 * panel SAYS so under the schedule ("won't start until a version is
 * deployed"), and says "paused" while the binding is off, instead of
 * promising a next run that nothing will start.
 *
 * Lives in the inspector when no node is selected; fields stack in one
 * column so they fit the panel. Prefer {@link WorkflowSettings} for the
 * production surface (one Save for trigger + projects).
 */
export function TriggerEditor({
  organizationId,
  name,
  /** Authoring is developer-gated server-side; readers still see the binding. */
  canEdit,
  /**
   * When false, Save / Rotate / Remove are omitted — the parent owns them
   * through `onControllerChange` (the workflow inspector footer).
   */
  showActions = true,
  deployedVersion,
  onControllerChange,
}: {
  organizationId: string;
  name: string;
  canEdit: boolean;
  showActions?: boolean;
  /** The version triggers start — undefined while nothing is deployed, when
   * the panel says a schedule will not start rather than when it will. */
  deployedVersion?: number | undefined;
  onControllerChange?: (controller: TriggerEditorController | null) => void;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  // The public webhook endpoint. External callers POST here; the token is the
  // last path segment and is shown only once (stored as a hash), so a revisit
  // shows a `<token>` placeholder and points to Rotate. The origin the operator
  // is browsing IS the deployment origin (dev proxies /api/* to the backend), so it
  // is the base of the URL an external caller uses.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const webhookUrl = (token: string): string =>
    `${origin}/api/automations/webhook/${token}`;
  const headingId = useId();
  const cronId = useId();
  const eventId = useId();

  const triggersQuery = useAutomationTriggers(organizationId, name);
  const setTrigger = useSetAutomationTrigger();
  const deleteTrigger = useDeleteAutomationTrigger();

  const stored = triggersQuery.data?.[0];

  const [kind, setKind] = useState<TriggerKind>('schedule');
  const [cron, setCron] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [eventName, setEventName] = useState('');
  // A NEW binding starts OFF: the docs say to keep Enabled off while
  // preparing, and a binding that armed itself the moment a cron was typed
  // started runs nobody had asked for yet.
  const [enabled, setEnabled] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Whether the author opened the form for a binding that does not exist
  // yet — without one the panel says "no trigger" instead of drawing an
  // empty schedule that looks armed.
  const [adding, setAdding] = useState(false);

  // Load the stored binding into the form whenever it changes under us —
  // the row is the truth; local state only carries unsaved edits.
  useEffect(() => {
    if (stored === undefined) return;
    if (isTriggerKind(stored.kind)) setKind(stored.kind);
    setCron(stored.cron ?? '');
    setTimezone(stored.timezone ?? 'UTC');
    setEventName(stored.event ?? '');
    setEnabled(stored.enabled);
    setAdding(false);
  }, [stored]);

  const dirty = useMemo(() => {
    if (stored === undefined) {
      return (
        cron !== '' ||
        (timezone !== '' && timezone !== 'UTC') ||
        eventName !== '' ||
        kind !== 'schedule' ||
        enabled
      );
    }
    return (
      kind !== stored.kind ||
      cron !== (stored.cron ?? '') ||
      timezone !== (stored.timezone ?? 'UTC') ||
      eventName !== (stored.event ?? '') ||
      enabled !== stored.enabled
    );
  }, [stored, kind, cron, timezone, eventName, enabled]);

  const timezoneOptions = useMemo<SearchableSelectOption[]>(
    () =>
      listTimezoneOptions(timezone).map((zone) => ({
        value: zone,
        label: zone,
      })),
    [timezone],
  );

  // The validator's verdict and the words under the field — shared with
  // the blank-automation wizard, so both surfaces refuse the same crons.
  const {
    preview: cronPreview,
    description: cronNextDescription,
    invalidText: cronInvalidText,
    pattern: cronPattern,
  } = useCronPreview(cron, timezone, kind === 'schedule');

  // What the schedule will actually do: nothing while the switch is off,
  // nothing until a version is deployed (the occurrence it WOULD take is
  // still named, so the author knows what arming means), the next run else.
  const cronDescription = useMemo(() => {
    if (kind !== 'schedule' || cronPreview.kind !== 'ok') {
      return cronNextDescription;
    }
    const lead = cronPattern === undefined ? '' : `${cronPattern} · `;
    if (!enabled) return `${lead}${t('trigger.paused')}`;
    if (deployedVersion === undefined) {
      return `${lead}${t('trigger.notDeployed', {
        at: formatDate(cronPreview.nextAt, 'long'),
      })}`;
    }
    return cronNextDescription;
  }, [
    kind,
    cronPreview,
    cronNextDescription,
    cronPattern,
    enabled,
    deployedVersion,
    t,
    formatDate,
  ]);

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

  const saveRef = useRef(save);
  saveRef.current = save;

  const blocked = kind === 'schedule' && cronPreview.kind === 'invalid';
  const canRotate = kind === 'webhook' && stored?.hasToken === true;
  const canRemove = stored !== undefined;
  // The form draws for a stored binding, or once the author asked to add one.
  const showForm = stored !== undefined || (canEdit && adding);

  useEffect(() => {
    if (onControllerChange === undefined) return undefined;
    onControllerChange({
      dirty,
      pending: setTrigger.isPending,
      blocked,
      canRotate,
      canRemove,
      removePending: deleteTrigger.isPending,
      save: () => {
        saveRef.current();
      },
      rotate: () => {
        saveRef.current(true);
      },
      requestRemove: () => {
        setConfirmRemove(true);
      },
    });
    return () => {
      onControllerChange(null);
    };
  }, [
    onControllerChange,
    dirty,
    setTrigger.isPending,
    blocked,
    canRotate,
    canRemove,
    deleteTrigger.isPending,
  ]);

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-sm font-semibold">
              {t('trigger.title')}
            </h3>
            {dirty && canEdit && (
              <Badge variant="orange">{t('trigger.unsavedBadge')}</Badge>
            )}
          </div>
          {stored?.lastFiredAt != null && (
            <Text as="p" variant="muted" className="text-xs">
              {t('trigger.lastFired', {
                at: formatDate(new Date(stored.lastFiredAt), 'long'),
              })}
            </Text>
          )}
        </div>
        {showForm && (
          <Switch
            label={t('trigger.enabledLabel')}
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!canEdit}
          />
        )}
      </header>

      <div className="flex min-h-0 flex-col gap-3">
        {!showForm && (
          <div className="flex flex-col items-start gap-2">
            <Text as="p" variant="muted" className="text-sm">
              {t('trigger.none')}
            </Text>
            {canEdit && (
              <Button
                size="sm"
                variant="secondary"
                icon={Plus}
                onClick={() => {
                  setAdding(true);
                }}
              >
                {t('trigger.add')}
              </Button>
            )}
          </div>
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

        {showForm && (
          <div className="grid gap-3">
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
                <Field
                  label={t('trigger.cronLabel')}
                  htmlFor={cronId}
                  description={
                    cronPreview.kind === 'invalid' ? undefined : cronDescription
                  }
                  error={cronInvalidText}
                >
                  <Input
                    id={cronId}
                    value={cron}
                    placeholder="0 */6 * * *"
                    readOnly={!canEdit}
                    onChange={(event) => setCron(event.target.value)}
                    className="font-mono"
                  />
                </Field>
                <SearchableSelect
                  label={t('trigger.timezoneLabel')}
                  options={timezoneOptions}
                  value={timezone || null}
                  onValueChange={setTimezone}
                  disabled={!canEdit}
                  searchPlaceholder={t('trigger.timezoneSearch')}
                  emptyText={t('trigger.timezoneEmpty')}
                  placeholder="UTC"
                />
              </>
            )}
            {kind === 'event' && (
              <Field label={t('trigger.eventLabel')} htmlFor={eventId}>
                <Select
                  id={eventId}
                  placeholder={t('trigger.eventPlaceholder')}
                  disabled={!canEdit}
                  options={EMITTED_EVENT_TYPES.map((value) => ({
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
              <div className="flex flex-col gap-1">
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
                  {`${origin}/api/projects/<projectId>/automations/webhook/${mintedToken ?? '<token>'}`}
                </code>
              </div>
            )}
          </div>
        )}
      </div>

      {canEdit && showActions && showForm && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            isLoading={setTrigger.isPending}
            disabled={
              (!dirty && stored !== undefined) ||
              (kind === 'schedule' && cronPreview.kind === 'invalid')
            }
            disabledReason={
              kind === 'schedule' && cronInvalidText !== undefined
                ? cronInvalidText
                : t('trigger.nothingToSave')
            }
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
        isLoading={deleteTrigger.isPending}
        onConfirm={() => {
          setRefusal(null);
          setMintedToken(null);
          deleteTrigger.mutate(
            { organizationId, name },
            {
              onSuccess: () => {
                setConfirmRemove(false);
                // Back to "no trigger" — with a fresh, OFF form next time.
                setAdding(false);
                setKind('schedule');
                setCron('');
                setTimezone('UTC');
                setEventName('');
                setEnabled(false);
              },
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
